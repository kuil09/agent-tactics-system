import { TaskInputKind } from "../../contracts/enums.js";
import type { TaskEnvelope, TaskEnvelopeInput } from "../../contracts/types.js";

export interface RepoAdapter {
  read(path: string): Promise<string> | string;
  write(path: string, content: string): Promise<void> | void;
}

export interface SnapshotCapableRepoAdapter extends RepoAdapter {
  createSnapshot(): Promise<unknown> | unknown;
  restoreSnapshot(snapshot: unknown): Promise<void> | void;
}

export interface MaterializedTaskInput extends TaskEnvelopeInput {
  content: string | null;
}

export class InMemoryRepoAdapter implements RepoAdapter {
  private readonly files = new Map<string, string>();

  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this.files.set(path, content);
      }
    }
  }

  read(path: string): string {
    const content = this.files.get(path);

    if (content === undefined) {
      throw new Error(`repo path not found: ${path}`);
    }

    return content;
  }

  write(path: string, content: string): void {
    this.files.set(path, content);
  }

  createSnapshot(): Record<string, string> {
    return Object.fromEntries(this.files.entries());
  }

  restoreSnapshot(snapshot: unknown): void {
    if (!isStringRecord(snapshot)) {
      throw new Error("repo snapshot must be a string record");
    }

    this.files.clear();

    for (const [path, content] of Object.entries(snapshot)) {
      this.files.set(path, content);
    }
  }
}

export async function materializeTaskInputs(
  envelope: TaskEnvelope,
  repo: RepoAdapter,
): Promise<MaterializedTaskInput[]> {
  const resolvedInputs: MaterializedTaskInput[] = [];

  for (const input of envelope.inputs) {
    if (input.kind === TaskInputKind.File) {
      resolvedInputs.push({
        ...input,
        content: await repo.read(input.ref),
      });
      continue;
    }

    resolvedInputs.push({
      ...input,
      content: null,
    });
  }

  return resolvedInputs;
}

export function isSnapshotCapableRepoAdapter(
  repo: RepoAdapter,
): repo is SnapshotCapableRepoAdapter {
  return (
    typeof (repo as SnapshotCapableRepoAdapter).createSnapshot === "function" &&
    typeof (repo as SnapshotCapableRepoAdapter).restoreSnapshot === "function"
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
