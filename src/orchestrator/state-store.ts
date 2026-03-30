import { PatchOperation } from "../contracts/enums.js";
import type { StatePatch } from "../contracts/types.js";

export type CanonicalState = Record<string, unknown>;

export interface StateSnapshot<TState extends CanonicalState = CanonicalState> {
  version: number;
  state: TState;
}

export interface AppliedStatePatch<TState extends CanonicalState = CanonicalState> {
  version: number;
  patch: StatePatch;
  state: TState;
}

export class StateVersionConflictError extends Error {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `state version mismatch: expected ${expectedVersion}, received ${actualVersion}`,
    );
    this.name = "StateVersionConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class StateStore<TState extends CanonicalState = CanonicalState> {
  private currentVersion = 0;
  private currentState: TState;
  private readonly history = new Map<number, TState>();

  constructor(initialState?: TState) {
    this.currentState = cloneState(initialState ?? ({} as TState));
    this.history.set(this.currentVersion, cloneState(this.currentState));
  }

  getSnapshot(): StateSnapshot<TState> {
    return {
      version: this.currentVersion,
      state: cloneState(this.currentState),
    };
  }

  getStateAtVersion(version: number): StateSnapshot<TState> | null {
    const state = this.history.get(version);
    if (!state) {
      return null;
    }

    return {
      version,
      state: cloneState(state),
    };
  }

  applyPatch(patch: StatePatch): AppliedStatePatch<TState> {
    if (patch.base_state_version !== this.currentVersion) {
      throw new StateVersionConflictError(
        patch.base_state_version,
        this.currentVersion,
      );
    }

    const draft = cloneState(this.currentState);

    for (const operation of patch.operations) {
      applyOperation(draft, operation);
    }

    this.currentVersion += 1;
    this.currentState = draft;
    this.history.set(this.currentVersion, cloneState(this.currentState));

    return {
      version: this.currentVersion,
      patch,
      state: cloneState(this.currentState),
    };
  }
}

type MutableContainer = Record<string, unknown> | unknown[];

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function applyOperation(
  root: CanonicalState,
  operation: StatePatch["operations"][number],
): void {
  if (operation.path === "/") {
    throw new Error("root-level replacement is not supported in v1");
  }

  const tokens = decodePointer(operation.path);
  const parentTokens = tokens.slice(0, -1);
  const finalToken = tokens.at(-1);

  if (!finalToken) {
    throw new Error(`invalid patch path: ${operation.path}`);
  }

  const parent = resolveContainer(root, parentTokens);

  switch (operation.op) {
    case PatchOperation.Add:
    case PatchOperation.Replace:
      writeValue(parent, finalToken, cloneState(operation.value));
      return;
    case PatchOperation.Remove:
      removeValue(parent, finalToken);
      return;
    default:
      throw new Error(`unsupported patch operation: ${operation.op satisfies never}`);
  }
}

function decodePointer(path: string): string[] {
  if (!path.startsWith("/")) {
    throw new Error(`JSON pointer must start with '/': ${path}`);
  }

  return path
    .split("/")
    .slice(1)
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function resolveContainer(
  root: CanonicalState,
  tokens: string[],
): MutableContainer {
  let current: unknown = root;

  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(token, 10);
      current = current[index];
      continue;
    }

    if (isRecord(current)) {
      if (!(token in current)) {
        current[token] = {};
      }

      current = current[token];
      continue;
    }

    throw new Error(`patch path traverses a non-container at '${token}'`);
  }

  if (!Array.isArray(current) && !isRecord(current)) {
    throw new Error("patch target parent must be an object or array");
  }

  return current;
}

function writeValue(
  container: MutableContainer,
  token: string,
  value: unknown,
): void {
  if (Array.isArray(container)) {
    const index = token === "-" ? container.length : Number.parseInt(token, 10);
    container[index] = value;
    return;
  }

  container[token] = value;
}

function removeValue(container: MutableContainer, token: string): void {
  if (Array.isArray(container)) {
    const index = Number.parseInt(token, 10);
    container.splice(index, 1);
    return;
  }

  delete container[token];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
