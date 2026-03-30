import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSummaryVerificationHandoff,
  buildVerificationEvidenceSummary,
  coerceScenario,
  parseScenario,
  runRuntimeFixtureCli,
} from "../../src/runtime/cli.js";
import { HeartbeatOutcome, ProviderKind, VerificationStatus } from "../../src/contracts/enums.js";

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
        verification_handoff: {
          contract_version: string;
          evidence: { artifacts: Array<{ kind: string; path: string; status: string }> };
          recovery: { attempted: boolean };
        };
        verification_evidence: { promotion_gate: string; summary_path: string };
      };

      expect(summary.outcome).toBe("patched");
      expect(summary.verification_handoff.contract_version).toBe("m2");
      expect(summary.verification_handoff.recovery.attempted).toBe(false);
      expect(
        summary.verification_handoff.evidence.artifacts.find(
          (artifact) => artifact.kind === "execution_log",
        ),
      ).toMatchObject({
        kind: "execution_log",
        path: result.runtimeLogPath,
        status: "present",
      });
      expect(summary.verification_evidence).toMatchObject({
        promotion_gate: "waiting_for_independent_verifier",
        summary_path: result.summaryPath,
      });
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
        verification_handoff: {
          evidence: { missing_artifacts: string[] };
          recovery: {
            attempted: boolean;
            repo_restored: boolean;
            outcome_classification: string;
          };
        };
        verification_evidence: { promotion_gate: string; runtime_log_path: string };
      };

      expect(summary.outcome).toBe("blocked");
      expect(summary.verification_handoff.recovery).toMatchObject({
        attempted: true,
        repo_restored: true,
        outcome_classification: "rolled_back_and_requeued",
      });
      expect(summary.verification_handoff.evidence.missing_artifacts).toEqual([
        result.runtimeLogPath,
      ]);
      expect(summary.verification_evidence).toMatchObject({
        promotion_gate: "rollback_and_requeue_recorded",
        runtime_log_path: result.runtimeLogPath,
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

  it("summarizes non-required verification evidence and preserves unknown artifacts", () => {
    const handoff = {
      contract_version: "m2" as const,
      subject_id: "issue-cli-helper",
      executor_provider_id: "openai-runtime",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      outcome: HeartbeatOutcome.Patched,
      rollback_to_version: 1,
      replay: {
        subject_id: "issue-cli-helper",
        verification_ids: [],
        evidence: [],
        latest_status: VerificationStatus.Pending,
        latest_created_at: null,
        status_counts: {
          pending: 0,
          pass: 0,
          fail: 0,
          requeue: 0,
        },
        recovery_paths: [],
        timeline: [],
      },
      evidence: {
        verification_required: false,
        independent_verifier_required: false,
        handoff_ready: true,
        summary: "runtime completed without an independent verifier requirement",
        commands: ["npm run runtime:fixture"],
        artifacts: [
          {
            label: "unmapped artifact",
            kind: "custom_artifact",
            path: "state://custom",
            required: false,
            status: "pending",
          } as never,
        ],
        missing_artifacts: [],
      },
      recovery: {
        attempted: false,
        outcome_classification: "not_needed" as const,
        strategy: "none" as const,
        rollback_to_version: 1,
        repo_restored: false,
        requeued: false,
        reason: null,
        steps: [],
      },
    };

    const summarized = buildSummaryVerificationHandoff({
      scenario: "success",
      artifactDir: "/tmp/artifacts",
      workspaceDir: "/tmp/workspace",
      summaryPath: "/tmp/run-result.json",
      runtimeLogPath: "/tmp/workspace/artifacts/runtime.log",
      handoff,
    });
    const evidenceSummary = buildVerificationEvidenceSummary({
      scenario: "success",
      artifactDir: "/tmp/artifacts",
      workspaceDir: "/tmp/workspace",
      summaryPath: "/tmp/run-result.json",
      runtimeLogPath: "/tmp/workspace/artifacts/runtime.log",
      handoff,
    });

    expect(summarized.evidence.artifacts).toEqual([
      {
        label: "unmapped artifact",
        kind: "custom_artifact",
        path: "state://custom",
        required: false,
        status: "pending",
      },
    ]);
    expect(evidenceSummary).toMatchObject({
      contract_version: "m2",
      promotion_gate: "not_required",
      recovery_outcome: "not_needed",
    });
  });
});
