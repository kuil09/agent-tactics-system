import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  coerceScenario,
  parseScenario,
  runRuntimeFixtureCli,
} from "../../src/runtime/cli.js";

describe("runtime fixture cli", () => {
  it("writes shared success artifacts", async () => {
    const rootDir = join(process.cwd(), ".tmp-runtime-cli-success");

    try {
      const result = await runRuntimeFixtureCli({
        scenario: "success",
        rootDir,
      });

      expect(result.outcome).toBe("patched");
      await expect(readFile(result.runtimeLogPath, "utf8")).resolves.toBe(
        "Connect heartbeat records to the shared runtime entrypoint :: wire runtime",
      );

      const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
        outcome: string;
        verification_handoff: { recovery: { attempted: boolean } };
      };

      expect(summary.outcome).toBe("patched");
      expect(summary.verification_handoff.recovery.attempted).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("captures rollback evidence for the failure path", async () => {
    const rootDir = join(process.cwd(), ".tmp-runtime-cli-failure");

    try {
      const result = await runRuntimeFixtureCli({
        scenario: "failure",
        rootDir,
      });

      expect(result.outcome).toBe("blocked");
      await expect(readFile(result.runtimeLogPath, "utf8")).rejects.toThrow();

      const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
        outcome: string;
        verification_handoff: { recovery: { attempted: boolean; repo_restored: boolean } };
      };

      expect(summary.outcome).toBe("blocked");
      expect(summary.verification_handoff.recovery).toMatchObject({
        attempted: true,
        repo_restored: true,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("parses default and explicit scenarios", () => {
    expect(parseScenario([])).toBe("success");
    expect(parseScenario(["--scenario=failure"])).toBe("failure");
    expect(parseScenario(["--scenario", "success"])).toBe("success");
    expect(coerceScenario("failure")).toBe("failure");
  });

  it("rejects unknown scenarios", () => {
    expect(() => parseScenario(["--scenario=unknown"])).toThrow(
      "scenario must be one of: success, failure",
    );
    expect(() => coerceScenario(undefined)).toThrow(
      "scenario must be one of: success, failure",
    );
  });

  it("defaults the fixture root to the current working directory", async () => {
    const result = await runRuntimeFixtureCli({
      scenario: "success",
    });

    expect(result.artifactDir).toContain(`${process.cwd()}/artifacts/runtime-fixtures/success`);
  });
});
