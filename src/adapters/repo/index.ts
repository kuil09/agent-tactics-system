import { TaskInputKind } from "../../contracts/enums.js";
import type { TaskEnvelope, TaskEnvelopeInput } from "../../contracts/types.js";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

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

export class FileSystemRepoAdapter implements SnapshotCapableRepoAdapter {
  constructor(private readonly rootDir: string) {}

  async read(path: string): Promise<string> {
    try {
      return await readFile(this.resolve(path), "utf8");
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        throw new Error(`repo path not found: ${path}`);
      }

      throw error;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const resolved = this.resolve(path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf8");
  }

  async createSnapshot(): Promise<Record<string, string>> {
    return readTreeSnapshot(this.rootDir);
  }

  async restoreSnapshot(snapshot: unknown): Promise<void> {
    if (!isStringRecord(snapshot)) {
      throw new Error("repo snapshot must be a string record");
    }

    const restoreRoot = await mkdtemp(join(tmpdir(), "agent-tactics-system-restore-"));

    try {
      for (const [path, content] of Object.entries(snapshot)) {
        const destination = join(restoreRoot, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content, "utf8");
      }

      await rm(this.rootDir, { recursive: true, force: true });
      await mkdir(dirname(this.rootDir), { recursive: true });
      await mkdir(this.rootDir, { recursive: true });

      const restoredSnapshot = await readTreeSnapshot(restoreRoot);
      for (const [path, content] of Object.entries(restoredSnapshot)) {
        const destination = this.resolve(path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content, "utf8");
      }
    } finally {
      await rm(restoreRoot, { recursive: true, force: true });
    }
  }

  private resolve(path: string): string {
    return join(this.rootDir, path);
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

async function readTreeSnapshot(rootDir: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};

  await walkTree(rootDir, "", snapshot);

  return snapshot;
}

async function walkTree(
  absoluteDir: string,
  relativeDir: string,
  snapshot: Record<string, string>,
): Promise<void> {
  let entries;

  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const absolutePath = join(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      await walkTree(absolutePath, relativePath, snapshot);
      continue;
    }

    snapshot[relativePath] = await readFile(absolutePath, "utf8");
  }
}

function isNodeErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
