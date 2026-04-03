import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOperatorSummary,
  buildSummaryVerificationHandoff,
  buildVerificationEvidenceSummary,
  coerceScenario,
  coerceProviderKind,
  coerceProviderMode,
  parseScenario,
  parseRuntimeFixtureCliOptions,
  runRuntimeFixtureCli,
} from "../../src/runtime/cli.js";
import { HeartbeatOutcome, ProviderKind, VerificationStatus } from "../../src/contracts/enums.js";
import { startRuntimeFixtureProviderServer } from "../../src/runtime/runtime-fixture-provider-server.js";

describe("runtime fixture cli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("writes shared success artifacts", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "runtime-cli-success-"));

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
            workspace_binding_path: string;
          };
        };
        workspace_routing: {
          status: string;
          binding: {
            workspace_id: string;
            workspace_root: string;
            binding_source: string;
          };
          excluded_workspaces: Array<{ workspace_id: string; reason: string }>;
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
      expect(summary.workspace_routing).toMatchObject({
        status: "selected",
        binding: {
          workspace_id: "workspace-primary",
          workspace_root: result.workspaceDir,
          binding_source: "repo_preference_match",
        },
        excluded_workspaces: [
          {
            workspace_id: "workspace-fallback",
            reason: "repo url does not match the issue workspace preference",
          },
        ],
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
          workspace_binding_path: `${result.summaryPath}#workspace_routing.binding`,
        },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("captures rollback evidence for the failure path", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "runtime-cli-failure-"));

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
      await expect(readFile(join(result.workspaceDir, "src", "task.txt"), "utf8")).resolves.toBe(
        "rollback runtime",
      );
      await expect(
        readFile(join(result.workspaceDir, "artifacts", "seed-state.json"), "utf8"),
      ).resolves.toBe(
        JSON.stringify(
          {
            scenario: "failure",
            baseline: true,
          },
          null,
          2,
        ),
      );

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
        workspace_routing: {
          binding: {
            workspace_id: string;
            workspace_root: string;
          };
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
              modified_preexisting_paths: string[];
              created_paths: string[];
              restored_paths: string[];
              artifact_paths_missing_after_recovery: string[];
              residual_risk_paths: string[];
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
            modified_preexisting_paths: string[];
            created_paths: string[];
            restored_paths: string[];
            artifact_paths_missing_after_recovery: string[];
            residual_risk_paths: string[];
          };
        };
      };

      expect(summary.outcome).toBe("blocked");
      expect(summary.provider_handshake).toMatchObject({
        protocol_version: "provider-module-v1",
        metadata: { scenario: "failure" },
      });
      expect(summary.workspace_routing.binding).toMatchObject({
        workspace_id: "workspace-primary",
        workspace_root: result.workspaceDir,
      });
      expect(summary.verification_handoff.recovery).toMatchObject({
        attempted: true,
        repo_restored: true,
        outcome_classification: "rolled_back_and_requeued",
        scope: {
          changed_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
            "artifacts/seed-state.json",
            "src/generated.ts",
            "src/task.txt",
          ],
          modified_preexisting_paths: [
            "artifacts/seed-state.json",
            "src/task.txt",
          ],
          created_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
            "src/generated.ts",
          ],
          restored_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
            "artifacts/seed-state.json",
            "src/generated.ts",
            "src/task.txt",
          ],
          artifact_paths_missing_after_recovery: [
            result.workspaceDir + "/artifacts/partial-output.json",
            result.runtimeLogPath,
          ],
          residual_risk_paths: [
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
            "artifacts/seed-state.json",
            "src/generated.ts",
            "src/task.txt",
          ],
          modified_preexisting_paths: [
            "artifacts/seed-state.json",
            "src/task.txt",
          ],
          created_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
            "src/generated.ts",
          ],
          restored_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
            "artifacts/seed-state.json",
            "src/generated.ts",
            "src/task.txt",
          ],
          artifact_paths_missing_after_recovery: [
            result.workspaceDir + "/artifacts/partial-output.json",
            result.runtimeLogPath,
          ],
          residual_risk_paths: [
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
        "workspace_routing.binding.workspace_id must identify the routed execution workspace",
      );
      expect(summary.operator_summary.checks).toContain(
        "provider_handshake.protocol_version must be provider-module-v1",
      );
      expect(summary.operator_summary.checks).toContain(
        "heartbeat.outcome must be blocked",
      );
      expect(summary.operator_summary.checks).toContain(
        "verification_evidence.recovery_scope must separate modified_preexisting_paths, created_paths, restored_paths, and residual_risk_paths",
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

  it("defaults to the fixture provider target", () => {
    expect(parseRuntimeFixtureCliOptions([], {})).toMatchObject({
      scenario: "success",
      providerTarget: {
        mode: "fixture",
        providerId: "openai-runtime",
        providerKind: ProviderKind.OpenAI,
        modelId: "gpt-5.4",
      },
    });
    expect(coerceProviderMode(undefined)).toBe("fixture");
  });

  it("parses an external provider target from flags and env", () => {
    expect(
      parseRuntimeFixtureCliOptions(
        [
          "--scenario=failure",
          "--provider-mode=external",
          "--provider-base-url",
          "https://provider.test",
          "--provider-model",
          "gpt-4.1-mini",
          "--provider-id",
          "runtime-smoke",
        ],
        {
          RUNTIME_FIXTURE_PROVIDER_KIND: ProviderKind.LocalOpenAICompatible,
          RUNTIME_FIXTURE_PROVIDER_API_KEY: "secret-key",
        },
      ),
    ).toMatchObject({
      scenario: "failure",
      providerTarget: {
        mode: "external",
        providerId: "runtime-smoke",
        providerKind: ProviderKind.LocalOpenAICompatible,
        modelId: "gpt-4.1-mini",
        baseUrl: "https://provider.test",
        apiKey: "secret-key",
      },
    });
    expect(coerceProviderMode("external")).toBe("external");
    expect(coerceProviderKind("claude")).toBe(ProviderKind.Claude);
  });

  it("derives a provider-specific default identifier for claude", () => {
    expect(
      parseRuntimeFixtureCliOptions(
        [
          "--provider-mode=external",
          "--provider-kind=claude",
          "--provider-base-url=https://claude.test",
          "--provider-model=claude-sonnet-4-5",
        ],
        {},
      ),
    ).toMatchObject({
      providerTarget: {
        mode: "external",
        providerId: "claude-runtime",
        providerKind: ProviderKind.Claude,
        modelId: "claude-sonnet-4-5",
        baseUrl: "https://claude.test",
      },
    });
  });

  it("derives a provider-specific default identifier for copilot", () => {
    expect(
      parseRuntimeFixtureCliOptions(
        [
          "--provider-mode=external",
          "--provider-kind=copilot",
          "--provider-base-url=https://copilot.test",
          "--provider-model=gpt-4.1",
        ],
        {},
      ),
    ).toMatchObject({
      providerTarget: {
        mode: "external",
        providerId: "copilot-runtime",
        providerKind: ProviderKind.Copilot,
        modelId: "gpt-4.1",
        baseUrl: "https://copilot.test",
      },
    });
    expect(coerceProviderKind("copilot")).toBe(ProviderKind.Copilot);
  });

  it("rejects unknown scenarios", () => {
    expect(() => parseScenario(["--scenario=unknown"])).toThrow(
      "scenario must be one of: success, failure",
    );
    expect(() => coerceScenario(undefined)).toThrow(
      "scenario must be one of: success, failure",
    );
  });

  it("rejects invalid provider settings", () => {
    expect(() => coerceProviderMode("bad")).toThrow(
      "provider mode must be one of: fixture, external",
    );
    expect(() => coerceProviderKind("bad")).toThrow(
      "provider kind must be one of: openai, claude, opencode, copilot, cursor, local_openai_compatible, other",
    );
    expect(() =>
      parseRuntimeFixtureCliOptions(["--provider-mode=external"], {}),
    ).toThrow(
      "external provider mode requires --provider-base-url or RUNTIME_FIXTURE_PROVIDER_BASE_URL",
    );
    expect(() =>
      parseRuntimeFixtureCliOptions(
        ["--provider-mode=external", "--provider-base-url=https://provider.test"],
        {},
      ),
    ).toThrow(
      "external provider mode requires --provider-model or RUNTIME_FIXTURE_PROVIDER_MODEL_ID",
    );
  });

  it("defaults the fixture root to the current working directory", async () => {
    const result = await runRuntimeFixtureCli({
      scenario: "success",
    });

    expect(result.artifactDir).toContain(`${process.cwd()}/artifacts/runtime-fixtures/success`);
  });

  it("runs the fixture through the claude provider path", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "runtime-cli-claude-"));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "claude-sonnet-4-5" }],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: "Connect heartbeat records to the shared runtime entrypoint :: wire runtime",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await runRuntimeFixtureCli({
        scenario: "success",
        rootDir,
        providerTarget: {
          mode: "external",
          providerId: "claude-runtime",
          providerKind: ProviderKind.Claude,
          modelId: "claude-sonnet-4-5",
          baseUrl: "https://claude.test",
          apiKey: "claude-secret",
        },
      });

      const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
        provider_target: {
          provider_kind: string;
        };
        provider_handshake: {
          provider_kind: string;
          summary: string;
        };
      };

      expect(result.outcome).toBe("patched");
      expect(summary.provider_target.provider_kind).toBe(ProviderKind.Claude);
      expect(summary.provider_handshake).toMatchObject({
        provider_kind: ProviderKind.Claude,
        summary: "claude handshake established for claude-sonnet-4-5",
      });
      await expect(readFile(result.runtimeLogPath, "utf8")).resolves.toBe(
        "Connect heartbeat records to the shared runtime entrypoint :: wire runtime",
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("fails fast when workspace routing is blocked", async () => {
    vi.resetModules();
    vi.doMock("../../src/control-plane/workspace-routing.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../src/control-plane/workspace-routing.js")
      >("../../src/control-plane/workspace-routing.js");

      return {
        ...actual,
        routeExecutionWorkspace: () => ({
          status: "blocked" as const,
          code: "workspace_selection_ambiguous" as const,
          issueId: "runtime-cli-success",
          runId: "hb-cli-success",
          reason: "mocked routing block",
          candidateWorkspaceIds: ["workspace-primary"],
          requestedWorkspaceId: null,
          requestedRepoUrl: null,
          recovery: {
            action: "set_execution_workspace_id" as const,
            summary: "set executionWorkspaceId before retrying",
            targetWorkspaceId: null,
          },
        }),
      };
    });

    const { runRuntimeFixtureCli: runBlockedFixtureCli } = await import("../../src/runtime/cli.js");

    await expect(
      runBlockedFixtureCli({
        scenario: "success",
      }),
    ).rejects.toThrow(
      "runtime fixture workspace routing blocked: workspace_selection_ambiguous: mocked routing block",
    );

    vi.doUnmock("../../src/control-plane/workspace-routing.js");
    vi.resetModules();
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
          modified_preexisting_paths: [],
          created_paths: [],
          restored_paths: [],
          unrestored_paths: [],
          artifact_paths_missing_after_recovery: [],
          residual_risk_paths: [],
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
      workspaceBindingPath: "/tmp/run-result.json#workspace_routing.binding",
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
      operational_flow: "workspace_routed_runtime_fixture",
      final_status: "pending_approval_and_verification",
      key_paths: {
        summary_path: "/tmp/run-result.json",
        governance_path: "/tmp/run-result.json#verification_handoff.governance",
        provider_handshake_path: "/tmp/run-result.json#provider_handshake",
        workspace_binding_path: "/tmp/run-result.json#workspace_routing.binding",
      },
    });
  });

  it("preserves the shared artifact contract when using an external provider target", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "runtime-cli-external-"));
    const server = await startRuntimeFixtureProviderServer();

    try {
      const result = await runRuntimeFixtureCli({
        scenario: "success",
        rootDir,
        providerTarget: {
          mode: "external",
          providerId: "runtime-smoke",
          providerKind: ProviderKind.OpenAI,
          modelId: "gpt-5.4",
          baseUrl: server.baseUrl,
        },
      });

      const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
        provider_target: {
          mode: string;
          provider_id: string;
          provider_kind: string;
          model_id: string;
          base_url: string;
        };
        provider_handshake: {
          provider_id: string;
          provider_kind: string;
          model_id: string;
          protocol_version: string;
          metadata: { endpoint_origin: string; transport: string };
        };
      };

      expect(summary.provider_target).toEqual({
        mode: "external",
        provider_id: "runtime-smoke",
        provider_kind: ProviderKind.OpenAI,
        model_id: "gpt-5.4",
        base_url: server.baseUrl,
      });
      expect(summary.provider_handshake).toMatchObject({
        provider_id: "runtime-smoke",
        provider_kind: ProviderKind.OpenAI,
        model_id: "gpt-5.4",
        protocol_version: "provider-module-v1",
        metadata: {
          endpoint_origin: server.baseUrl,
          transport: "http",
        },
      });
    } finally {
      await server.close();
      await rm(rootDir, { recursive: true, force: true });
    }
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
            modified_preexisting_paths: [],
            created_paths: [],
            restored_paths: [],
            unrestored_paths: [],
            artifact_paths_missing_after_recovery: [],
            residual_risk_paths: [],
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
            modified_preexisting_paths: [],
            created_paths: [],
            restored_paths: [],
            unrestored_paths: [],
            artifact_paths_missing_after_recovery: [],
            residual_risk_paths: [],
          },
          steps: [],
        },
      },
    });

    expect(approvalOnly.promotion_gate).toBe("waiting_for_human_approval");
    expect(verifierOnly.promotion_gate).toBe("waiting_for_independent_verifier");
  });
});
