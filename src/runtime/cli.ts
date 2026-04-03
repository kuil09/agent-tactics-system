import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HeartbeatOutcome,
  ProviderKind,
  SideEffectLevel,
  TaskInputKind,
  TaskLevel,
  VerificationStatus,
  VerificationSubjectKind,
} from "../contracts/enums.js";
import type {
  HeartbeatRecord,
  TaskEnvelope,
  VerificationRecord,
} from "../contracts/types.js";
import {
  connectProviderApiAdapter,
  type ProviderApiModule,
} from "../adapters/provider-api/index.js";
import { FileSystemRepoAdapter } from "../adapters/repo/index.js";
import {
  routeExecutionWorkspace,
  type ExecutionWorkspaceCandidate,
  type ExecutionWorkspaceRoutingResult,
} from "../control-plane/workspace-routing.js";
import { StaticSkillLoader } from "../skills/loader.js";
import { createOpenAICompatibleProviderModule } from "./openai-compatible-provider.js";
import { runExecutableRuntime } from "./executable-runtime.js";
import { startRuntimeFixtureProviderServer } from "./runtime-fixture-provider-server.js";

export type RuntimeFixtureScenario = "success" | "failure";
export type RuntimeFixtureProviderMode = "fixture" | "external";

interface RuntimeFixtureProviderTargetBase {
  providerId: string;
  providerKind: ProviderKind;
  modelId: string;
}

export interface RuntimeFixtureProviderTargetFixture extends RuntimeFixtureProviderTargetBase {
  mode: "fixture";
}

export interface RuntimeFixtureProviderTargetExternal
  extends RuntimeFixtureProviderTargetBase {
  mode: "external";
  baseUrl: string;
  apiKey?: string;
}

export type RuntimeFixtureProviderTarget =
  | RuntimeFixtureProviderTargetFixture
  | RuntimeFixtureProviderTargetExternal;

export interface RuntimeFixtureCliOptions {
  scenario: RuntimeFixtureScenario;
  rootDir?: string;
  providerTarget?: RuntimeFixtureProviderTarget;
}

export interface RuntimeFixtureCliResult {
  scenario: RuntimeFixtureScenario;
  outcome: "patched" | "blocked";
  artifactDir: string;
  workspaceDir: string;
  summaryPath: string;
  runtimeLogPath: string;
  providerHandshakePath: string;
}

export interface RuntimeFixtureWorkspaceRoutingSummary {
  status: ExecutionWorkspaceRoutingResult["status"];
  available_workspaces: Array<{
    workspace_id: string;
    root_path: string;
    repo_url: string;
  }>;
  binding:
    | {
        issue_id: string;
        run_id: string;
        workspace_id: string;
        workspace_root: string;
        repo_url: string;
        project_workspace_id: string | null;
        bound_at: string;
        binding_source: string;
        candidate_workspace_ids: string[];
        preference_snapshot: {
          execution_workspace_id: string | null;
          repo_url: string | null;
          allow_project_workspace_fallback: boolean;
        };
      }
    | null;
  excluded_workspaces: Array<{
    workspace_id: string;
    reason: string;
  }>;
}

export interface RuntimeFixtureOperatorSummary {
  operational_flow:
    | "single_workspace_runtime_fixture"
    | "workspace_routed_runtime_fixture";
  scenario: RuntimeFixtureScenario;
  final_status: "pending_approval_and_verification" | "failed_and_requeued";
  decision: string;
  next_action: string;
  key_paths: {
    artifact_dir: string;
    workspace_dir: string;
    summary_path: string;
    runtime_log_path: string;
    governance_path: string;
    provider_handshake_path: string;
    workspace_binding_path?: string;
  };
  checks: string[];
}

export interface ParsedRuntimeFixtureCliOptions extends RuntimeFixtureCliOptions {
  providerTarget: RuntimeFixtureProviderTarget;
}

export async function runRuntimeFixtureCli(
  options: RuntimeFixtureCliOptions,
): Promise<RuntimeFixtureCliResult> {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const artifactDir = join(rootDir, "artifacts", "runtime-fixtures", options.scenario);
  const workspaceDir = join(artifactDir, "workspace");
  const fallbackWorkspaceDir = join(artifactDir, "workspace-fallback");
  const summaryPath = join(artifactDir, "run-result.json");
  const runtimeLogPath = join(workspaceDir, "artifacts", "runtime.log");
  const providerHandshakePath = `${summaryPath}#provider_handshake`;
  const workspaceBindingPath = `${summaryPath}#workspace_routing.binding`;

  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(fallbackWorkspaceDir, { recursive: true });

  const fixture = createRuntimeFixture(options.scenario);
  const workspaceCandidates = createRuntimeFixtureWorkspaceCandidates({
    workspaceDir,
    fallbackWorkspaceDir,
  });
  const workspaceRouting = routeExecutionWorkspace({
    issue: {
      issueId: fixture.heartbeat.issue_id,
      projectWorkspaceId: "workspace-primary",
      executionWorkspacePreference: {
        repoUrl: "https://github.com/kuil09/agent-tactics-system",
      },
    },
    runId: fixture.heartbeat.record_id,
    at: fixture.heartbeat.started_at,
    candidates: workspaceCandidates,
  });

  if (workspaceRouting.status !== "selected") {
    throw new Error(
      `runtime fixture workspace routing blocked: ${workspaceRouting.code}: ${workspaceRouting.reason}`,
    );
  }

  const repo = new FileSystemRepoAdapter(workspaceRouting.binding.workspaceRoot);
  await seedWorkspace(repo, options.scenario);

  const providerTarget =
    options.providerTarget ?? createDefaultRuntimeFixtureProviderTarget();
  const providerServer =
    providerTarget.mode === "fixture"
      ? await startRuntimeFixtureProviderServer()
      : null;

  try {
    const providerConfig =
      providerTarget.mode === "fixture"
        ? {
            ...providerTarget,
            baseUrl: ensureFixtureProviderBaseUrl(providerServer),
          }
        : providerTarget;
    const provider = await connectProviderApiAdapter({
      module: createRuntimeFixtureProviderModule(providerConfig),
      context: {
        scenario: options.scenario,
        workspace_root: workspaceRouting.binding.workspaceRoot,
        artifact_dir: artifactDir,
      },
    });
    const result = await runExecutableRuntime({
      heartbeat: fixture.heartbeat,
      envelope: fixture.envelope,
      provider,
      repo,
      skill_loader: fixture.skillLoader,
      required_skill_ids: fixture.requiredSkillIds,
      verification_records: fixture.verificationRecords,
    });

    await mkdir(dirname(summaryPath), { recursive: true });
    const operatorSummary = buildOperatorSummary({
      scenario: options.scenario,
      artifactDir,
      workspaceDir,
      summaryPath,
      runtimeLogPath,
      providerHandshakePath,
      workspaceBindingPath,
      handoff: result.verification_handoff,
    });
    await writeFile(
      summaryPath,
      `${JSON.stringify(
        {
          scenario: options.scenario,
          outcome:
            result.heartbeat.outcome === HeartbeatOutcome.Patched ? "patched" : "blocked",
          artifact_dir: artifactDir,
          workspace_dir: workspaceDir,
          runtime_log_path: runtimeLogPath,
          workspace_routing: buildWorkspaceRoutingSummary(
            workspaceRouting,
            workspaceCandidates,
          ),
          provider_target: summarizeProviderTarget(providerConfig),
          provider_handshake: provider.handshake,
          heartbeat: result.heartbeat,
          completed: result.completed,
          verification_handoff: buildSummaryVerificationHandoff({
            scenario: options.scenario,
            artifactDir,
            workspaceDir,
            summaryPath,
            runtimeLogPath,
            handoff: result.verification_handoff,
          }),
          verification_evidence: buildVerificationEvidenceSummary({
            scenario: options.scenario,
            artifactDir,
            workspaceDir,
            summaryPath,
            runtimeLogPath,
            handoff: result.verification_handoff,
          }),
          operator_summary: operatorSummary,
          recovered: result.recovered ?? null,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    return {
      scenario: options.scenario,
      outcome: result.heartbeat.outcome === HeartbeatOutcome.Patched ? "patched" : "blocked",
      artifactDir,
      workspaceDir,
      summaryPath,
      runtimeLogPath,
      providerHandshakePath,
    };
  } finally {
    if (providerServer) {
      await providerServer.close();
    }
  }
}

export function buildSummaryVerificationHandoff(input: {
  scenario: RuntimeFixtureScenario;
  artifactDir: string;
  workspaceDir: string;
  summaryPath: string;
  runtimeLogPath: string;
  handoff: Awaited<ReturnType<typeof runExecutableRuntime>>["verification_handoff"];
}) {
  const runtimeLogStatus = input.scenario === "success" ? "present" : "pending";
  const missingArtifacts =
    input.scenario === "success"
      ? []
      : input.handoff.recovery.scope.artifact_paths_missing_after_recovery.map((path) =>
          join(input.workspaceDir, path),
        );
  const residualRiskPaths =
    input.scenario === "success"
      ? []
      : input.handoff.recovery.scope.residual_risk_paths.map((path) =>
          join(input.workspaceDir, path),
        );

  return {
    ...input.handoff,
    recovery: {
      ...input.handoff.recovery,
      scope: {
        ...input.handoff.recovery.scope,
        artifact_paths_missing_after_recovery: missingArtifacts,
        residual_risk_paths: residualRiskPaths,
      },
    },
    evidence: {
      ...input.handoff.evidence,
      artifacts: input.handoff.evidence.artifacts.map((artifact) => {
        if (artifact.kind === "execution_log") {
          return {
            ...artifact,
            path: input.runtimeLogPath,
            required: true,
            status: runtimeLogStatus,
          };
        }

        if (artifact.kind === "state_snapshot") {
          return {
            ...artifact,
            path: `${input.summaryPath}#completed`,
          };
        }

        if (artifact.kind === "verification_replay") {
          return {
            ...artifact,
            path: `${input.summaryPath}#verification_handoff.replay`,
          };
        }

        if (artifact.kind === "approval_request") {
          return {
            ...artifact,
            path: `${input.summaryPath}#verification_handoff.approval_workflow.request`,
          };
        }

        if (artifact.kind === "recovery_record") {
          return {
            ...artifact,
            path: `${input.summaryPath}#verification_handoff.recovery`,
          };
        }

        if (artifact.kind === "approval_record") {
          return {
            ...artifact,
            path: `${input.summaryPath}#verification_handoff.approval_workflow.decision`,
          };
        }

        return artifact;
      }),
      missing_artifacts: missingArtifacts,
    },
  };
}

export function buildVerificationEvidenceSummary(input: {
  scenario: RuntimeFixtureScenario;
  artifactDir: string;
  workspaceDir: string;
  summaryPath: string;
  runtimeLogPath: string;
  handoff: Awaited<ReturnType<typeof runExecutableRuntime>>["verification_handoff"];
}) {
  return {
    contract_version: input.handoff.contract_version,
    scenario: input.scenario,
    promotion_gate:
      input.handoff.outcome === HeartbeatOutcome.Blocked
          ? "rollback_and_requeue_recorded"
          : input.handoff.evidence.approval_required &&
              input.handoff.evidence.independent_verifier_required &&
              input.scenario === "success"
            ? "waiting_for_human_approval_and_independent_verifier"
            : input.handoff.evidence.approval_required && input.scenario === "success"
              ? "waiting_for_human_approval"
              : input.handoff.evidence.independent_verifier_required && input.scenario === "success"
                ? "waiting_for_independent_verifier"
                : "not_required",
    approval_status: input.handoff.evidence.approval_status,
    approval_artifact_path: input.handoff.approval_workflow.decision.decision_artifact_path
      ? `${input.summaryPath}#verification_handoff.approval_workflow.decision`
      : null,
    authorization_exception: input.handoff.governance.authorization_boundary.exception,
    input_boundary_summary: input.handoff.governance.input_defense.map((entry) => ({
      input_ref: entry.input_ref,
      input_kind: entry.input_kind,
      trust_zone: entry.trust_zone,
    })),
    audit_trail_paths: input.handoff.governance.audit_trail.map((entry) => entry.path),
    validation_commands: input.handoff.evidence.commands,
    artifact_dir: input.artifactDir,
    workspace_dir: input.workspaceDir,
    summary_path: input.summaryPath,
    runtime_log_path: input.runtimeLogPath,
    missing_artifacts:
      input.scenario === "success"
        ? []
        : input.handoff.recovery.scope.artifact_paths_missing_after_recovery.map((path) =>
            join(input.workspaceDir, path),
          ),
    recovery_outcome: input.handoff.recovery.outcome_classification,
    recovery_scope: {
      attempted_write_paths: input.handoff.recovery.scope.attempted_write_paths,
      changed_paths: input.handoff.recovery.scope.changed_paths,
      modified_preexisting_paths:
        input.handoff.recovery.scope.modified_preexisting_paths,
      created_paths: input.handoff.recovery.scope.created_paths,
      restored_paths: input.handoff.recovery.scope.restored_paths,
      unrestored_paths: input.handoff.recovery.scope.unrestored_paths,
      artifact_paths_missing_after_recovery:
        input.scenario === "success"
          ? []
          : input.handoff.recovery.scope.artifact_paths_missing_after_recovery.map((path) =>
              join(input.workspaceDir, path),
            ),
      residual_risk_paths:
        input.scenario === "success"
          ? []
          : input.handoff.recovery.scope.residual_risk_paths.map((path) =>
              join(input.workspaceDir, path),
            ),
    },
  };
}

export function buildOperatorSummary(input: {
  scenario: RuntimeFixtureScenario;
  artifactDir: string;
  workspaceDir: string;
  summaryPath: string;
  runtimeLogPath: string;
  providerHandshakePath: string;
  workspaceBindingPath: string;
  handoff: Awaited<ReturnType<typeof runExecutableRuntime>>["verification_handoff"];
}): RuntimeFixtureOperatorSummary {
  return {
    operational_flow: "workspace_routed_runtime_fixture",
    scenario: input.scenario,
    final_status:
      input.scenario === "success" ? "pending_approval_and_verification" : "failed_and_requeued",
    decision:
      input.scenario === "success"
        ? "Runtime execution finished on a routed workspace, but promotion remains closed until a human approval artifact and independent verification are both present."
        : "Runtime execution failed. Rollback and requeue were recorded for the next attempt.",
    next_action:
      input.scenario === "success"
        ? "Open run-result.json, confirm workspace_routing.binding, approval_workflow, and input_defense, then collect the approval decision artifact and run the listed validation commands."
        : "Open run-result.json, confirm workspace_routing.binding, recovery.steps, restored_paths, and residual_risk_paths, then inspect the requeued inputs before retrying.",
    key_paths: {
      artifact_dir: input.artifactDir,
      workspace_dir: input.workspaceDir,
      summary_path: input.summaryPath,
      runtime_log_path: input.runtimeLogPath,
      governance_path: `${input.summaryPath}#verification_handoff.governance`,
      provider_handshake_path: input.providerHandshakePath,
      workspace_binding_path: input.workspaceBindingPath,
    },
    checks:
      input.scenario === "success"
        ? [
            "workspace_routing.binding.workspace_id must identify the routed execution workspace",
            "provider_handshake.protocol_version must be provider-module-v1",
            "heartbeat.outcome must be patched",
            "verification_evidence.promotion_gate must be waiting_for_human_approval_and_independent_verifier",
            "verification_handoff.approval_workflow.status must be pending_human_approval",
            "runtime_log_path must exist",
          ]
        : [
            "workspace_routing.binding.workspace_id must identify the routed execution workspace",
            "provider_handshake.protocol_version must be provider-module-v1",
            "heartbeat.outcome must be blocked",
            "verification_evidence.promotion_gate must be rollback_and_requeue_recorded",
            "verification_handoff.recovery.steps must show repo_restore, state_rollback, and issue_requeue as completed",
            "verification_evidence.recovery_scope must separate modified_preexisting_paths, created_paths, restored_paths, and residual_risk_paths",
          ],
  };
}

interface RuntimeFixtureDefinition {
  heartbeat: HeartbeatRecord;
  envelope: TaskEnvelope;
  skillLoader: StaticSkillLoader;
  requiredSkillIds: string[];
  verificationRecords: VerificationRecord[];
}

function createRuntimeFixture(
  scenario: RuntimeFixtureScenario,
): RuntimeFixtureDefinition {
  const skillLoader = new StaticSkillLoader([
    {
      contract: {
        skill_id: "runtime-writer",
        purpose: "Write runtime changes",
        preconditions: ["workspace is available"],
        allowed_roles: ["engineer"],
        allowed_targets: ["src", "artifacts", "tests"],
        side_effect_level: SideEffectLevel.WriteLocal,
        requires_lock: false,
        verification_required: true,
        failure_recovery: ["rerun runtime fixture"],
      },
      source: "runtime-cli-fixture",
    },
  ]);

  const heartbeat: HeartbeatRecord = {
    record_id: `hb-cli-${scenario}`,
    agent_id: "runtime-cli",
    issue_id: createRuntimeFixtureIssueId(scenario),
    turn_number: scenario === "success" ? 1 : 2,
    inputs_summary:
      scenario === "success"
        ? "Replay the shared runtime success path with a pending approval gate"
        : "Replay the shared runtime rollback path with approval evidence preserved",
    allowed_action_budget: {
      tool_calls: 8,
      write_ops: scenario === "success" ? 1 : 5,
    },
    started_at: "2026-03-31T00:00:00Z",
    finished_at: "2026-03-31T00:02:00Z",
    outcome: HeartbeatOutcome.Noop,
  };

  const envelope: TaskEnvelope = {
    objective:
      scenario === "success"
        ? "Connect heartbeat records to the shared runtime entrypoint"
        : "Exercise shared runtime rollback and requeue",
    task_level: TaskLevel.L3,
    inputs: [
      {
        kind: TaskInputKind.File,
        ref: "src/task.txt",
      },
      {
        kind: TaskInputKind.ExternalNote,
        ref: "browser://operator-approval-request",
      },
    ],
    allowed_tools: ["node", "vitest"],
    write_scope: ["src", "tests", "artifacts"],
    must_not: ["modify docs/architecture.md"],
    done_when:
      scenario === "success"
        ? ["runtime fixture completes and emits approval-gated artifacts"]
        : ["runtime fixture requeues after rollback"],
    stop_conditions: ["missing skill"],
    output_schema_ref: "schemas/verification-record.schema.json",
    verification_required: true,
    rollback_hint: "remove artifacts/runtime.log",
  };

  const verificationRecords: VerificationRecord[] =
    scenario === "success"
      ? [
          {
            verification_id: "verify-success",
            subject_id: "runtime-cli-success",
            subject_kind: VerificationSubjectKind.Task,
            verifier_provider_id: "claude-verify",
            verifier_model: "claude-sonnet-4",
            status: VerificationStatus.Pass,
            evidence: ["previous replay evidence"],
            created_at: "2026-03-30T23:50:00Z",
          },
        ]
      : [
          {
            verification_id: "verify-fail",
            subject_id: "runtime-cli-failure",
            subject_kind: VerificationSubjectKind.Task,
            verifier_provider_id: "claude-verify",
            verifier_model: "claude-sonnet-4",
            status: VerificationStatus.Fail,
            evidence: ["verification rejected execution"],
            created_at: "2026-03-30T23:50:00Z",
          },
          {
            verification_id: "verify-requeue",
            subject_id: "runtime-cli-failure",
            subject_kind: VerificationSubjectKind.Task,
            verifier_provider_id: "claude-verify",
            verifier_model: "claude-sonnet-4",
            status: VerificationStatus.Requeue,
            evidence: ["requeue after rollback"],
            created_at: "2026-03-30T23:51:00Z",
          },
        ];

  return {
    heartbeat,
    envelope,
    skillLoader,
    requiredSkillIds: ["runtime-writer"],
    verificationRecords,
  };
}

function buildWorkspaceRoutingSummary(
  routing: Extract<ExecutionWorkspaceRoutingResult, { status: "selected" }>,
  candidates: ExecutionWorkspaceCandidate[],
): RuntimeFixtureWorkspaceRoutingSummary {
  return {
    status: routing.status,
    available_workspaces: candidates.map((candidate) => ({
      workspace_id: candidate.workspaceId,
      root_path: candidate.rootPath,
      repo_url: candidate.repoUrl,
    })),
    binding: {
      issue_id: routing.binding.issueId,
      run_id: routing.binding.runId,
      workspace_id: routing.binding.workspaceId,
      workspace_root: routing.binding.workspaceRoot,
      repo_url: routing.binding.repoUrl,
      project_workspace_id: routing.binding.projectWorkspaceId,
      bound_at: routing.binding.boundAt,
      binding_source: routing.binding.bindingSource,
      candidate_workspace_ids: routing.binding.candidateWorkspaceIds,
      preference_snapshot: {
        execution_workspace_id: routing.binding.preferenceSnapshot.executionWorkspaceId,
        repo_url: routing.binding.preferenceSnapshot.repoUrl,
        allow_project_workspace_fallback:
          routing.binding.preferenceSnapshot.allowProjectWorkspaceFallback,
      },
    },
    excluded_workspaces: routing.excluded.map((workspace) => ({
      workspace_id: workspace.workspaceId,
      reason: workspace.reason,
    })),
  };
}

function createRuntimeFixtureWorkspaceCandidates(input: {
  workspaceDir: string;
  fallbackWorkspaceDir: string;
}): ExecutionWorkspaceCandidate[] {
  return [
    {
      workspaceId: "workspace-primary",
      rootPath: input.workspaceDir,
      repoUrl: "https://github.com/kuil09/agent-tactics-system",
    },
    {
      workspaceId: "workspace-fallback",
      rootPath: input.fallbackWorkspaceDir,
      repoUrl: "https://github.com/kuil09/operator-playbooks",
    },
  ];
}

function createRuntimeFixtureIssueId(scenario: RuntimeFixtureScenario): string {
  return `runtime-cli-${scenario}`;
}

function createRuntimeFixtureProviderModule(
  config:
    | (RuntimeFixtureProviderTargetFixture & { baseUrl: string })
    | RuntimeFixtureProviderTargetExternal,
): ProviderApiModule {
  return createOpenAICompatibleProviderModule({
    providerId: config.providerId,
    providerKind: config.providerKind,
    modelId: config.modelId,
    baseUrl: config.baseUrl,
    apiKey: config.mode === "external" ? config.apiKey : undefined,
  });
}

async function seedWorkspace(
  repo: FileSystemRepoAdapter,
  scenario: RuntimeFixtureScenario,
): Promise<void> {
  await repo.write(
    "src/task.txt",
    scenario === "success" ? "wire runtime" : "rollback runtime",
  );
  await repo.write(
    "artifacts/seed-state.json",
    JSON.stringify(
      {
        scenario,
        baseline: true,
      },
      null,
      2,
    ),
  );
}

/* c8 ignore start */
async function main(): Promise<void> {
  const options = parseRuntimeFixtureCliOptions(process.argv.slice(2), process.env);
  const result = await runRuntimeFixtureCli(options);
  const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
    operator_summary: RuntimeFixtureOperatorSummary;
  };

  process.stdout.write(
    `${JSON.stringify(
      {
        scenario: result.scenario,
        outcome: result.outcome,
        artifact_dir: result.artifactDir,
        workspace_dir: result.workspaceDir,
        summary_path: result.summaryPath,
        runtime_log_path: result.runtimeLogPath,
        provider_handshake_path: result.providerHandshakePath,
        operator_summary: summary.operator_summary,
      },
      null,
      2,
    )}\n`,
  );
}
/* c8 ignore end */

export function parseScenario(args: string[]): RuntimeFixtureScenario {
  const scenarioFlag = args.find((arg) => arg.startsWith("--scenario="));

  if (scenarioFlag) {
    return coerceScenario(scenarioFlag.slice("--scenario=".length));
  }

  const scenarioIndex = args.indexOf("--scenario");
  if (scenarioIndex >= 0) {
    return coerceScenario(args[scenarioIndex + 1]);
  }

  return "success";
}

export function coerceScenario(value: string | undefined): RuntimeFixtureScenario {
  if (value === "success" || value === "failure") {
    return value;
  }

  throw new Error("scenario must be one of: success, failure");
}

export function parseRuntimeFixtureCliOptions(
  args: string[],
  env: NodeJS.ProcessEnv,
): ParsedRuntimeFixtureCliOptions {
  return {
    scenario: parseScenario(args),
    providerTarget: parseRuntimeFixtureProviderTarget(args, env),
  };
}

export function parseRuntimeFixtureProviderTarget(
  args: string[],
  env: NodeJS.ProcessEnv,
): RuntimeFixtureProviderTarget {
  const mode = coerceProviderMode(
    readRuntimeFixtureOption(args, "--provider-mode") ?? env.RUNTIME_FIXTURE_PROVIDER_MODE,
  );

  if (mode === "fixture") {
    return createDefaultRuntimeFixtureProviderTarget();
  }

  const baseUrl =
    readRuntimeFixtureOption(args, "--provider-base-url") ??
    env.RUNTIME_FIXTURE_PROVIDER_BASE_URL;
  const modelId =
    readRuntimeFixtureOption(args, "--provider-model") ??
    env.RUNTIME_FIXTURE_PROVIDER_MODEL_ID;

  if (!baseUrl) {
    throw new Error(
      "external provider mode requires --provider-base-url or RUNTIME_FIXTURE_PROVIDER_BASE_URL",
    );
  }

  if (!modelId) {
    throw new Error(
      "external provider mode requires --provider-model or RUNTIME_FIXTURE_PROVIDER_MODEL_ID",
    );
  }

  return {
    mode,
    providerId:
      readRuntimeFixtureOption(args, "--provider-id") ??
      env.RUNTIME_FIXTURE_PROVIDER_ID ??
      "openai-runtime",
    providerKind: coerceProviderKind(
      readRuntimeFixtureOption(args, "--provider-kind") ??
        env.RUNTIME_FIXTURE_PROVIDER_KIND ??
        ProviderKind.OpenAI,
    ),
    modelId,
    baseUrl,
    apiKey:
      readRuntimeFixtureOption(args, "--provider-api-key") ??
      env.RUNTIME_FIXTURE_PROVIDER_API_KEY,
  };
}

export function coerceProviderMode(
  value: string | undefined,
): RuntimeFixtureProviderMode {
  if (!value || value === "fixture") {
    return "fixture";
  }

  if (value === "external") {
    return value;
  }

  throw new Error("provider mode must be one of: fixture, external");
}

export function coerceProviderKind(value: string | undefined): ProviderKind {
  if (value && Object.values(ProviderKind).includes(value as ProviderKind)) {
    return value as ProviderKind;
  }

  throw new Error(
    "provider kind must be one of: openai, claude, opencode, cursor, local_openai_compatible, other",
  );
}

function createDefaultRuntimeFixtureProviderTarget(): RuntimeFixtureProviderTargetFixture {
  return {
    mode: "fixture",
    providerId: "openai-runtime",
    providerKind: ProviderKind.OpenAI,
    modelId: "gpt-5.4",
  };
}

function summarizeProviderTarget(
  providerTarget:
    | (RuntimeFixtureProviderTargetFixture & { baseUrl: string })
    | RuntimeFixtureProviderTargetExternal,
) {
  return {
    mode: providerTarget.mode,
    provider_id: providerTarget.providerId,
    provider_kind: providerTarget.providerKind,
    model_id: providerTarget.modelId,
    base_url: providerTarget.baseUrl,
  };
}

function readRuntimeFixtureOption(
  args: string[],
  flag: `--${string}`,
): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));

  if (inline) {
    return inline.slice(flag.length + 1);
  }

  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function ensureFixtureProviderBaseUrl(
  providerServer: Awaited<ReturnType<typeof startRuntimeFixtureProviderServer>> | null,
): string {
  if (!providerServer) {
    throw new Error("fixture provider server was not started");
  }

  return providerServer.baseUrl;
}
/* c8 ignore start */
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === resolve(modulePath)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
/* c8 ignore end */
