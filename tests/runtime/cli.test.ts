import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildOperatorSummary,
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
      expect(result.providerHandshakePath).toBe(`${result.summaryPath}#provider_handshake`);
      await expect(readFile(result.runtimeLogPath, "utf8")).resolves.toBe(
        "Connect heartbeat records to the shared runtime entrypoint :: wire runtime",
      );

      const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
        outcome: string;
        provider_handshake: {
          protocol_version: string;
          summary: string;
          metadata: { scenario: string };
        };
        operator_summary: {
          final_status: string;
          key_paths: {
            runtime_log_path: string;
            governance_path: string;
            provider_handshake_path: string;
          };
        };
        verification_handoff: {
          contract_version: string;
          approval_workflow: {
            status: string;
          };
          evidence: { artifacts: Array<{ kind: string; path: string; status: string }> };
          governance: {
            approval_gate: { status: string };
          };
          recovery: { attempted: boolean };
        };
        verification_evidence: {
          promotion_gate: string;
          summary_path: string;
          approval_status: string;
          authorization_exception: string;
          input_boundary_summary: Array<{ input_kind: string; trust_zone: string }>;
        };
      };

      expect(summary.outcome).toBe("patched");
      expect(summary.provider_handshake).toMatchObject({
        protocol_version: "provider-module-v1",
        metadata: { scenario: "success" },
      });
      expect(summary.verification_handoff.contract_version).toBe("m5");
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
      expect(
        summary.verification_handoff.evidence.artifacts.find(
          (artifact) => artifact.kind === "approval_request",
        ),
      ).toMatchObject({
        kind: "approval_request",
        path: `${result.summaryPath}#verification_handoff.approval_workflow.request`,
        status: "present",
      });
      expect(
        summary.verification_handoff.evidence.artifacts.find(
          (artifact) => artifact.kind === "approval_record",
        ),
      ).toMatchObject({
        kind: "approval_record",
        path: `${result.summaryPath}#verification_handoff.approval_workflow.decision`,
        status: "present",
      });
      expect(summary.verification_evidence).toMatchObject({
        promotion_gate: "waiting_for_human_approval_and_independent_verifier",
        approval_status: "pending_human_approval",
        authorization_exception:
          "promotion to complete is denied without a recorded human approval artifact and approval:grant permission",
        summary_path: result.summaryPath,
      });
      expect(summary.verification_evidence.input_boundary_summary).toContainEqual({
        input_kind: "external_note",
        input_ref: "browser://operator-approval-request",
        trust_zone: "untrusted_external_input",
      });
      expect(summary.verification_handoff.approval_workflow.status).toBe(
        "pending_human_approval",
      );
      expect(summary.operator_summary).toMatchObject({
        final_status: "pending_approval_and_verification",
        key_paths: {
          runtime_log_path: result.runtimeLogPath,
          governance_path: `${result.summaryPath}#verification_handoff.governance`,
          provider_handshake_path: result.providerHandshakePath,
        },
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
      expect(result.providerHandshakePath).toBe(`${result.summaryPath}#provider_handshake`);
      await expect(readFile(result.runtimeLogPath, "utf8")).rejects.toThrow();
      await expect(
        readFile(join(result.workspaceDir, "artifacts", "partial-output.json"), "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(join(result.workspaceDir, "src", "generated.ts"), "utf8"),
      ).rejects.toThrow();

      const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
        outcome: string;
        provider_handshake: {
          protocol_version: string;
          metadata: { scenario: string };
        };
        operator_summary: {
          final_status: string;
          checks: string[];
        };
        verification_handoff: {
          approval_workflow: {
            status: string;
          };
          evidence: { missing_artifacts: string[] };
          governance: {
            approval_gate: { status: string };
          };
          recovery: {
            attempted: boolean;
            repo_restored: boolean;
            outcome_classification: string;
            scope: {
              changed_paths: string[];
              restored_paths: string[];
              artifact_paths_missing_after_recovery: string[];
            };
          };
        };
        verification_evidence: {
          promotion_gate: string;
          runtime_log_path: string;
          approval_status: string;
          missing_artifacts: string[];
          recovery_scope: {
            changed_paths: string[];
            restored_paths: string[];
            artifact_paths_missing_after_recovery: string[];
          };
        };
      };

      expect(summary.outcome).toBe("blocked");
      expect(summary.provider_handshake).toMatchObject({
        protocol_version: "provider-module-v1",
        metadata: { scenario: "failure" },
      });
      expect(summary.verification_handoff.recovery).toMatchObject({
        attempted: true,
        repo_restored: true,
        outcome_classification: "rolled_back_and_requeued",
        scope: {
          changed_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
            "src/generated.ts",
          ],
          restored_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
            "src/generated.ts",
          ],
          artifact_paths_missing_after_recovery: [
            result.workspaceDir + "/artifacts/partial-output.json",
            result.runtimeLogPath,
          ],
        },
      });
      expect(summary.verification_handoff.evidence.missing_artifacts).toEqual([
        result.workspaceDir + "/artifacts/partial-output.json",
        result.runtimeLogPath,
      ]);
      expect(summary.verification_evidence).toMatchObject({
        promotion_gate: "rollback_and_requeue_recorded",
        approval_status: "blocked_by_recovery",
        runtime_log_path: result.runtimeLogPath,
        missing_artifacts: [
          result.workspaceDir + "/artifacts/partial-output.json",
          result.runtimeLogPath,
        ],
        recovery_scope: {
          changed_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
            "src/generated.ts",
          ],
          restored_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
            "src/generated.ts",
          ],
          artifact_paths_missing_after_recovery: [
            result.workspaceDir + "/artifacts/partial-output.json",
            result.runtimeLogPath,
          ],
        },
      });
      expect(summary.verification_handoff.approval_workflow.status).toBe(
        "blocked_by_recovery",
      );
      expect(summary.operator_summary.final_status).toBe("failed_and_requeued");
      expect(summary.operator_summary.checks).toContain(
        "provider_handshake.protocol_version must be provider-module-v1",
      );
      expect(summary.operator_summary.checks).toContain(
        "heartbeat.outcome must be blocked",
      );
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
      contract_version: "m5" as const,
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
        approval_required: false,
        approval_status: "not_required" as const,
        handoff_ready: true,
        summary: "runtime completed without an independent verifier or approval requirement",
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
      approval_workflow: {
        workflow_id: "approval-issue-cli-helper",
        status: "not_required" as const,
        request: {
          requested_role: "human_operator" as const,
          request_channel: "handoff_artifact" as const,
          request_artifact_path: null,
          issued_at: null,
          summary: "No separate approval request is required for this envelope.",
          required_evidence: [],
          validation_commands: [],
        },
        decision: {
          status: "not_required" as const,
          decision_artifact_path: null,
          recorded_by: null,
          recorded_at: null,
          resolution_criteria: [],
          blocked_reason: null,
        },
        release: {
          promotion_action: "promote_done_candidate_to_complete" as const,
          release_blocked: false,
          blockers: [],
          unblock_checklist: [],
          next_owner: "system_orchestrator" as const,
        },
      },
      governance: {
        approval_gate: {
          policy_id: "human_approval_required_for_promotion" as const,
          approval_required: false,
          status: "not_required" as const,
          approver_role: "human_operator" as const,
          artifact_path: null,
          promotion_blocked: false,
          rationale: "This envelope does not require a separate human approval gate.",
        },
        authorization_boundary: {
          promotion_action: "promote_done_candidate_to_complete" as const,
          required_permission: "approval:grant" as const,
          allowed: true,
          exception: null,
        },
        input_defense: [],
        audit_trail: [],
      },
      recovery: {
        attempted: false,
        outcome_classification: "not_needed" as const,
        strategy: "none" as const,
        rollback_to_version: 1,
        repo_restored: false,
        requeued: false,
        reason: null,
        scope: {
          attempted_write_paths: [],
          changed_paths: [],
          restored_paths: [],
          unrestored_paths: [],
          artifact_paths_missing_after_recovery: [],
        },
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
    const operatorSummary = buildOperatorSummary({
      scenario: "success",
      artifactDir: "/tmp/artifacts",
      workspaceDir: "/tmp/workspace",
      summaryPath: "/tmp/run-result.json",
      runtimeLogPath: "/tmp/workspace/artifacts/runtime.log",
      providerHandshakePath: "/tmp/run-result.json#provider_handshake",
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
      contract_version: "m5",
      promotion_gate: "not_required",
      approval_status: "not_required",
      recovery_outcome: "not_needed",
    });
    expect(operatorSummary).toMatchObject({
      operational_flow: "single_workspace_runtime_fixture",
      final_status: "pending_approval_and_verification",
      key_paths: {
        summary_path: "/tmp/run-result.json",
        governance_path: "/tmp/run-result.json#verification_handoff.governance",
        provider_handshake_path: "/tmp/run-result.json#provider_handshake",
      },
    });
  });

  it("distinguishes approval-only and verifier-only promotion gates", () => {
    const approvalOnly = buildVerificationEvidenceSummary({
      scenario: "success",
      artifactDir: "/tmp/artifacts",
      workspaceDir: "/tmp/workspace",
      summaryPath: "/tmp/run-result.json",
      runtimeLogPath: "/tmp/workspace/artifacts/runtime.log",
      handoff: {
        contract_version: "m5",
        subject_id: "issue-approval-only",
        executor_provider_id: "openai-runtime",
        executor_provider_kind: ProviderKind.OpenAI,
        executor_model: "gpt-5.4",
        outcome: HeartbeatOutcome.Patched,
        rollback_to_version: 1,
        replay: {
          subject_id: "issue-approval-only",
          verification_ids: [],
          evidence: [],
          latest_status: null,
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
          verification_required: true,
          independent_verifier_required: false,
          approval_required: true,
          approval_status: "pending_human_approval",
          handoff_ready: true,
          summary: "waiting for approval only",
          commands: [],
          artifacts: [],
          missing_artifacts: [],
        },
        approval_workflow: {
          workflow_id: "approval-issue-approval-only",
          status: "pending_human_approval" as const,
          request: {
            requested_role: "human_operator" as const,
            request_channel: "handoff_artifact" as const,
            request_artifact_path: "state://approval-request",
            issued_at: null,
            summary: "approval request",
            required_evidence: [],
            validation_commands: [],
          },
          decision: {
            status: "pending_human_approval" as const,
            decision_artifact_path: "state://approval",
            recorded_by: null,
            recorded_at: null,
            resolution_criteria: [],
            blocked_reason: "approval missing",
          },
          release: {
            promotion_action: "promote_done_candidate_to_complete" as const,
            release_blocked: true,
            blockers: ["approval missing"],
            unblock_checklist: [],
            next_owner: "human_operator" as const,
          },
        },
        governance: {
          approval_gate: {
            policy_id: "human_approval_required_for_promotion",
            approval_required: true,
            status: "pending_human_approval",
            approver_role: "human_operator",
            artifact_path: "state://approval",
            promotion_blocked: true,
            rationale: "approval required",
          },
          authorization_boundary: {
            promotion_action: "promote_done_candidate_to_complete",
            required_permission: "approval:grant",
            allowed: false,
            exception: "approval missing",
          },
          input_defense: [],
          audit_trail: [],
        },
        recovery: {
          attempted: false,
          outcome_classification: "not_needed",
          strategy: "none",
          rollback_to_version: 1,
          repo_restored: false,
          requeued: false,
          reason: null,
          scope: {
            attempted_write_paths: [],
            changed_paths: [],
            restored_paths: [],
            unrestored_paths: [],
            artifact_paths_missing_after_recovery: [],
          },
          steps: [],
        },
      },
    });

    const verifierOnly = buildVerificationEvidenceSummary({
      scenario: "success",
      artifactDir: "/tmp/artifacts",
      workspaceDir: "/tmp/workspace",
      summaryPath: "/tmp/run-result.json",
      runtimeLogPath: "/tmp/workspace/artifacts/runtime.log",
      handoff: {
        contract_version: "m5",
        subject_id: "issue-verifier-only",
        executor_provider_id: "openai-runtime",
        executor_provider_kind: ProviderKind.OpenAI,
        executor_model: "gpt-5.4",
        outcome: HeartbeatOutcome.Patched,
        rollback_to_version: 1,
        replay: {
          subject_id: "issue-verifier-only",
          verification_ids: [],
          evidence: [],
          latest_status: null,
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
          verification_required: true,
          independent_verifier_required: true,
          approval_required: false,
          approval_status: "not_required",
          handoff_ready: true,
          summary: "waiting for verifier only",
          commands: [],
          artifacts: [],
          missing_artifacts: [],
        },
        approval_workflow: {
          workflow_id: "approval-issue-verifier-only",
          status: "not_required" as const,
          request: {
            requested_role: "human_operator" as const,
            request_channel: "handoff_artifact" as const,
            request_artifact_path: null,
            issued_at: null,
            summary: "approval not required",
            required_evidence: [],
            validation_commands: [],
          },
          decision: {
            status: "not_required" as const,
            decision_artifact_path: null,
            recorded_by: null,
            recorded_at: null,
            resolution_criteria: [],
            blocked_reason: null,
          },
          release: {
            promotion_action: "promote_done_candidate_to_complete" as const,
            release_blocked: false,
            blockers: [],
            unblock_checklist: [],
            next_owner: "system_orchestrator" as const,
          },
        },
        governance: {
          approval_gate: {
            policy_id: "human_approval_required_for_promotion",
            approval_required: false,
            status: "not_required",
            approver_role: "human_operator",
            artifact_path: null,
            promotion_blocked: false,
            rationale: "approval not required",
          },
          authorization_boundary: {
            promotion_action: "promote_done_candidate_to_complete",
            required_permission: "approval:grant",
            allowed: true,
            exception: null,
          },
          input_defense: [],
          audit_trail: [],
        },
        recovery: {
          attempted: false,
          outcome_classification: "not_needed",
          strategy: "none",
          rollback_to_version: 1,
          repo_restored: false,
          requeued: false,
          reason: null,
          scope: {
            attempted_write_paths: [],
            changed_paths: [],
            restored_paths: [],
            unrestored_paths: [],
            artifact_paths_missing_after_recovery: [],
          },
          steps: [],
        },
      },
    });

    expect(approvalOnly.promotion_gate).toBe("waiting_for_human_approval");
    expect(verifierOnly.promotion_gate).toBe("waiting_for_independent_verifier");
  });
});
