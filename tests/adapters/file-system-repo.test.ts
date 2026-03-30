import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { FileSystemRepoAdapter } from "../../src/adapters/repo/index.js";

describe("file system repo adapter", () => {
  it("reads, writes, snapshots, and restores workspace files", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "agent-tactics-system-repo-"));

    try {
      const repo = new FileSystemRepoAdapter(rootDir);

      await repo.write("src/task.txt", "initial runtime task");
      await repo.write("artifacts/runtime.log", "first pass");

      const snapshot = await repo.createSnapshot();

      await repo.write("src/task.txt", "mutated runtime task");
      await repo.write("artifacts/extra.log", "transient");

      await repo.restoreSnapshot(snapshot);

      await expect(repo.read("src/task.txt")).resolves.toBe("initial runtime task");
      await expect(repo.read("artifacts/runtime.log")).resolves.toBe("first pass");
      await expect(repo.read("artifacts/extra.log")).rejects.toThrow(
        "repo path not found: artifacts/extra.log",
      );
      await expect(
        readFile(join(rootDir, "artifacts", "runtime.log"), "utf8"),
      ).resolves.toBe("first pass");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("surfaces missing files with the repo adapter error shape", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "agent-tactics-system-repo-"));

    try {
      const repo = new FileSystemRepoAdapter(rootDir);
      await expect(repo.read("missing.txt")).rejects.toThrow("repo path not found: missing.txt");
      await expect(repo.createSnapshot()).resolves.toEqual({});
      await expect(repo.restoreSnapshot({ invalid: 1 })).rejects.toThrow(
        "repo snapshot must be a string record",
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rethrows non-ENOENT file system errors", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "agent-tactics-system-repo-"));
    const fileRoot = join(rootDir, "file-root.txt");
    const directoryPath = join(rootDir, "subdir");
    const missingRoot = join(rootDir, "missing-root");

    try {
      const repo = new FileSystemRepoAdapter(rootDir);
      await repo.write("file-root.txt", "root file");
      await repo.write("subdir/task.txt", "task");

      await expect(repo.read("subdir")).rejects.toMatchObject({
        code: "EISDIR",
      });

      const invalidRootRepo = new FileSystemRepoAdapter(fileRoot);
      await expect(invalidRootRepo.createSnapshot()).rejects.toMatchObject({
        code: "ENOTDIR",
      });

      const nestedFileRepo = new FileSystemRepoAdapter(directoryPath);
      await expect(nestedFileRepo.createSnapshot()).resolves.toEqual({
        "task.txt": "task",
      });

      const missingRootRepo = new FileSystemRepoAdapter(missingRoot);
      await expect(missingRootRepo.createSnapshot()).resolves.toEqual({});
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
