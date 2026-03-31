import {
  HeartbeatOutcome,
  PatchOperation,
  ProviderKind,
  TaskInputKind,
} from "../contracts/enums.js";
import type {
  HeartbeatRecord,
  StateOperation,
  TaskEnvelope,
  VerificationRecord,
} from "../contracts/types.js";
import type { ProviderApiAdapter } from "../adapters/provider-api/index.js";
import { executeTaskEnvelope } from "../adapters/provider-api/index.js";
import {
  isSnapshotCapableRepoAdapter,
  type RepoAdapter,
} from "../adapters/repo/index.js";
import type { SkillLoader } from "../skills/contracts.js";
import {
  type CanonicalState,
  type StateSnapshot,
  StateStore,
} from "../orchestrator/state-store.js";
import { TurnLoop } from "../orchestrator/turn-loop.js";
import { buildVerificationReplay, type VerificationReplaySummary } from "../verifier/replay.js";

export interface ExecutableRuntimeState extends CanonicalState {
  status?: string;
  objective?: string;
  task_level?: string;
  heartbeat?: HeartbeatRecord;
  execution?: {
    provider_id: string;
    model_id: string;
    summary: string;
    required_skill_ids: string[];
  };
  verification_handoff?: VerificationHandoff;
  governance?: GovernanceEvidence;
  recovery?: RuntimeRecoveryState;
  execution_error?: {
    message: string;
  };
}

export interface VerificationHandoff {
  contract_version: "m4";
  subject_id: string;
  executor_provider_id: string;
  executor_provider_kind: ProviderKind;
  executor_model: string;
  outcome: HeartbeatOutcome;
  rollback_to_version: number | null;
  replay: VerificationReplaySummary;
  evidence: VerificationEvidenceBundle;
  governance: GovernanceEvidence;
  recovery: RuntimeRecoveryState;
}

export type ApprovalGateStatus =
  | "pending_human_approval"
  | "not_required"
  | "blocked_by_recovery";

export interface VerificationEvidenceBundle {
  verification_required: boolean;
  independent_verifier_required: boolean;
  approval_required: boolean;
  approval_status: ApprovalGateStatus;
  handoff_ready: boolean;
  summary: string;
  commands: string[];
  artifacts: VerificationArtifact[];
  missing_artifacts: string[];
}

export interface VerificationArtifact {
  label: string;
  kind:
    | "state_snapshot"
    | "verification_replay"
    | "execution_log"
    | "recovery_record"
    | "approval_record";
  path: string;
  required: boolean;
  status: "present" | "pending";
}

export interface GovernanceEvidence {
  approval_gate: ApprovalGateEvidence;
  authorization_boundary: AuthorizationBoundaryEvidence;
  input_defense: InputDefenseEvidence[];
  audit_trail: GovernanceAuditEntry[];
}

export interface ApprovalGateEvidence {
  policy_id: "human_approval_required_for_promotion";
  approval_required: boolean;
  status: ApprovalGateStatus;
  approver_role: "human_operator";
  artifact_path: string | null;
  promotion_blocked: boolean;
  rationale: string;
}

export interface AuthorizationBoundaryEvidence {
  promotion_action: "promote_done_candidate_to_complete";
  required_permission: "approval:grant";
  allowed: boolean;
  exception: string | null;
}

export interface InputDefenseEvidence {
  input_ref: string;
  input_kind: TaskInputKind;
  trust_zone: "trusted_workspace" | "trusted_runtime_state" | "untrusted_external_input";
  handling_rule: string;
}

export interface GovernanceAuditEntry {
  event:
    | "approval_gate_declared"
    | "input_boundary_recorded"
    | "promotion_blocked"
    | "rollback_recorded";
  path: string;
  detail: string;
}

export interface RuntimeRecoveryState {
  attempted: boolean;
  outcome_classification: "not_needed" | "rolled_back_and_requeued";
  strategy: "none" | "rollback_and_requeue";
  rollback_to_version: number | null;
  repo_restored: boolean;
  requeued: boolean;
  reason: string | null;
  steps: RuntimeRecoveryStep[];
}

export interface RuntimeRecoveryStep {
  step: "repo_restore" | "state_rollback" | "issue_requeue";
  status: "skipped" | "completed";
  detail: string;
}

export interface RunExecutableRuntimeInput {
  heartbeat: HeartbeatRecord;
  envelope: TaskEnvelope;
  provider: ProviderApiAdapter & { provider_kind?: ProviderKind };
  repo: RepoAdapter;
  skill_loader: SkillLoader;
  required_skill_ids?: string[];
  verification_records?: VerificationRecord[];
  state_store?: StateStore<ExecutableRuntimeState>;
}

export interface ExecutableRuntimeResult {
  issued: StateSnapshot<ExecutableRuntimeState>;
  completed: StateSnapshot<ExecutableRuntimeState>;
  heartbeat: HeartbeatRecord;
  verification_handoff: VerificationHandoff;
  state_store: StateStore<ExecutableRuntimeState>;
  recovered?: StateSnapshot<ExecutableRuntimeState>;
}

export async function runExecutableRuntime(
  input: RunExecutableRuntimeInput,
): Promise<ExecutableRuntimeResult> {
  const stateStore =
    input.state_store ??
    new StateStore<ExecutableRuntimeState>({
      status: "queued",
    });
  const loop = new TurnLoop(stateStore);

  const issuedPatch = await loop.runWrite(({ getSnapshot }) => ({
    patch_id: `${input.heartbeat.record_id}:issue`,
    issue_id: input.heartbeat.issue_id,
    actor_id: input.heartbeat.agent_id,
    base_state_version: getSnapshot().version,
    operations: [
      {
        op: PatchOperation.Replace,
        path: "/status",
        value: "in_progress",
      },
      {
        op: PatchOperation.Add,
        path: "/objective",
        value: input.envelope.objective,
      },
      {
        op: PatchOperation.Add,
        path: "/task_level",
        value: input.envelope.task_level,
      },
      {
        op: PatchOperation.Add,
        path: "/heartbeat",
        value: {
          ...input.heartbeat,
          finished_at: null,
          outcome: HeartbeatOutcome.Noop,
        },
      },
    ],
    requires_lock: true,
    verifier_required: false,
    rollback_to_version: getSnapshot().version,
  }));

  const executionRollbackVersion = issuedPatch.patch.rollback_to_version;
  const repoSnapshot = isSnapshotCapableRepoAdapter(input.repo)
    ? await input.repo.createSnapshot()
    : null;

  try {
    const executed = await executeTaskEnvelope({
      envelope: input.envelope,
      provider: input.provider,
      repo: input.repo,
      skill_loader: input.skill_loader,
      required_skill_ids: input.required_skill_ids,
    });
    const governance = buildGovernanceEvidence({
      envelope: input.envelope,
      outcome: HeartbeatOutcome.Patched,
    });

    const verificationHandoff: VerificationHandoff = {
      contract_version: "m4",
      subject_id: input.heartbeat.issue_id,
      executor_provider_id: executed.result.provider_id,
      executor_provider_kind: input.provider.provider_kind ?? ProviderKind.Other,
      executor_model: executed.result.model_id,
      outcome: HeartbeatOutcome.Patched,
      rollback_to_version: issuedPatch.version,
      replay: buildVerificationReplay(
        input.heartbeat.issue_id,
        input.verification_records ?? [],
      ),
      evidence: buildVerificationEvidence({
        envelope: input.envelope,
        outcome: HeartbeatOutcome.Patched,
        verificationRequired: input.envelope.verification_required,
        rollbackToVersion: issuedPatch.version,
        recoveryAttempted: false,
      }),
      governance,
      recovery: {
        attempted: false,
        outcome_classification: "not_needed",
        strategy: "none",
        rollback_to_version: issuedPatch.version,
        repo_restored: false,
        requeued: false,
        reason: null,
        steps: [
          {
            step: "repo_restore",
            status: "skipped",
            detail: "execution completed without rollback",
          },
          {
            step: "state_rollback",
            status: "skipped",
            detail: "execution completed without rollback",
          },
          {
            step: "issue_requeue",
            status: "skipped",
            detail: "execution completed without requeue",
          },
        ],
      },
    };

    const completedPatch = await loop.runWrite(({ getSnapshot }) => ({
      patch_id: `${input.heartbeat.record_id}:complete`,
      issue_id: input.heartbeat.issue_id,
      actor_id: input.heartbeat.agent_id,
      base_state_version: getSnapshot().version,
      operations: [
        {
          op: PatchOperation.Replace,
          path: "/status",
          value: input.envelope.verification_required ? "done_candidate" : "complete",
        },
        {
          op: PatchOperation.Replace,
          path: "/heartbeat",
          value: {
            ...input.heartbeat,
            finished_at: input.heartbeat.finished_at,
            outcome: HeartbeatOutcome.Patched,
          },
        },
        {
          op: PatchOperation.Add,
          path: "/execution",
          value: {
            provider_id: executed.result.provider_id,
            model_id: executed.result.model_id,
            summary: executed.result.summary,
            required_skill_ids: input.required_skill_ids ?? [],
          },
        },
        {
          op: PatchOperation.Add,
          path: "/verification_handoff",
          value: verificationHandoff,
        },
        {
          op: PatchOperation.Add,
          path: "/governance",
          value: governance,
        },
        {
          op: PatchOperation.Add,
          path: "/recovery",
          value: verificationHandoff.recovery,
        },
      ],
      requires_lock: true,
      verifier_required: input.envelope.verification_required,
      rollback_to_version: issuedPatch.version,
    }));

    return {
      issued: {
        version: issuedPatch.version,
        state: issuedPatch.state,
      },
      completed: {
        version: completedPatch.version,
        state: completedPatch.state,
      },
      /* c8 ignore next 4 */
      heartbeat: completedPatch.state.heartbeat ?? {
        ...input.heartbeat,
        outcome: HeartbeatOutcome.Patched,
      },
      verification_handoff: verificationHandoff,
      state_store: stateStore,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let repoRestored = false;

    if (repoSnapshot !== null && isSnapshotCapableRepoAdapter(input.repo)) {
      await input.repo.restoreSnapshot(repoSnapshot);
      repoRestored = true;
    }

    /* c8 ignore next 4 */
    const rollbackSnapshot =
      executionRollbackVersion === null
        ? null
        : stateStore.getStateAtVersion(executionRollbackVersion);

    if (executionRollbackVersion !== null && rollbackSnapshot) {
      const currentSnapshot = stateStore.getSnapshot();
      const rollbackOperations = buildStateSyncOperations(
        currentSnapshot.state,
        rollbackSnapshot.state,
      );

      if (rollbackOperations.length > 0) {
        await loop.runWritePatch({
          patch_id: `${input.heartbeat.record_id}:rollback`,
          issue_id: input.heartbeat.issue_id,
          actor_id: input.heartbeat.agent_id,
          base_state_version: currentSnapshot.version,
          operations: rollbackOperations,
          requires_lock: true,
          verifier_required: false,
          rollback_to_version: executionRollbackVersion,
        });
      }
    }

    const recoveryState: RuntimeRecoveryState = {
      attempted: true,
      outcome_classification: "rolled_back_and_requeued",
      strategy: "rollback_and_requeue",
      rollback_to_version: executionRollbackVersion,
      repo_restored: repoRestored,
      requeued: true,
      reason: message,
      steps: [
        {
          step: "repo_restore",
          status: repoRestored ? "completed" : "skipped",
          detail: repoRestored
            ? "repository snapshot restored"
            : "snapshot restore unavailable for this repo adapter",
        },
        {
          step: "state_rollback",
          status: "completed",
          /* c8 ignore next 3 */
          detail:
            executionRollbackVersion === null
              ? "state store requeue patch applied without rollback version"
              : `state restored to version ${executionRollbackVersion}`,
        },
        {
          step: "issue_requeue",
          status: "completed",
          detail: "issue returned to queued state after failure",
        },
      ],
    };
    const governance = buildGovernanceEvidence({
      envelope: input.envelope,
      outcome: HeartbeatOutcome.Blocked,
    });
    const verificationHandoff: VerificationHandoff = {
      contract_version: "m4",
      subject_id: input.heartbeat.issue_id,
      executor_provider_id: input.provider.provider_id,
      executor_provider_kind: input.provider.provider_kind ?? ProviderKind.Other,
      executor_model: input.provider.model_id,
      outcome: HeartbeatOutcome.Blocked,
      rollback_to_version: executionRollbackVersion,
      replay: buildVerificationReplay(
        input.heartbeat.issue_id,
        input.verification_records ?? [],
      ),
      evidence: buildVerificationEvidence({
        envelope: input.envelope,
        outcome: HeartbeatOutcome.Blocked,
        verificationRequired: input.envelope.verification_required,
        rollbackToVersion: executionRollbackVersion,
        recoveryAttempted: true,
      }),
      governance,
      recovery: recoveryState,
    };
    const recoveredPatch = await loop.runWrite(({ getSnapshot }) => ({
      patch_id: `${input.heartbeat.record_id}:requeue`,
      issue_id: input.heartbeat.issue_id,
      actor_id: input.heartbeat.agent_id,
      base_state_version: getSnapshot().version,
      operations: [
        {
          op: PatchOperation.Replace,
          path: "/status",
          value: "queued",
        },
        {
          op: PatchOperation.Replace,
          path: "/heartbeat",
          value: {
            ...input.heartbeat,
            finished_at: input.heartbeat.finished_at,
            outcome: HeartbeatOutcome.Blocked,
          },
        },
        {
          op: PatchOperation.Add,
          path: "/execution_error",
          value: {
            message,
          },
        },
        {
          op: PatchOperation.Add,
          path: "/verification_handoff",
          value: verificationHandoff,
        },
        {
          op: PatchOperation.Add,
          path: "/governance",
          value: governance,
        },
        {
          op: PatchOperation.Add,
          path: "/recovery",
          value: recoveryState,
        },
      ],
      requires_lock: true,
      verifier_required: false,
      rollback_to_version: executionRollbackVersion,
    }));

    return {
      issued: {
        version: issuedPatch.version,
        state: issuedPatch.state,
      },
      completed: {
        version: recoveredPatch.version,
        state: recoveredPatch.state,
      },
      /* c8 ignore next 5 */
      heartbeat: recoveredPatch.state.heartbeat ?? {
        ...input.heartbeat,
        finished_at: input.heartbeat.finished_at,
        outcome: HeartbeatOutcome.Blocked,
      },
      verification_handoff: verificationHandoff,
      state_store: stateStore,
      recovered: {
        version: recoveredPatch.version,
        state: recoveredPatch.state,
      },
    };
  }
}

function buildVerificationEvidence(input: {
  envelope: TaskEnvelope;
  outcome: HeartbeatOutcome;
  verificationRequired: boolean;
  rollbackToVersion: number | null;
  recoveryAttempted: boolean;
}): VerificationEvidenceBundle {
  const governance = buildGovernanceEvidence({
    envelope: input.envelope,
    outcome: input.outcome,
  });
  const artifacts: VerificationArtifact[] = [
    {
      label: "canonical state snapshot",
      kind: "state_snapshot",
      path: "state://completed",
      required: true,
      status: "present",
    },
    {
      label: "verification replay history",
      kind: "verification_replay",
      path: "state://verification_handoff/replay",
      required: input.verificationRequired,
      status: input.verificationRequired ? "present" : "pending",
    },
    {
      label: "runtime execution log",
      kind: "execution_log",
      path: "workspace://artifacts/runtime.log",
      required: false,
      status: "pending",
    },
    {
      label: "approval gate record",
      kind: "approval_record",
      path: "state://verification_handoff/governance/approval_gate",
      required: governance.approval_gate.approval_required,
      status: governance.approval_gate.approval_required ? "present" : "pending",
    },
    {
      label: "recovery record",
      kind: "recovery_record",
      path: "state://recovery",
      required: input.recoveryAttempted,
      status: input.recoveryAttempted ? "present" : "pending",
    },
  ];

  const missingArtifacts = artifacts
    .filter((artifact) => artifact.required && artifact.status !== "present")
    .map((artifact) => artifact.path);

  return {
    verification_required: input.verificationRequired,
    independent_verifier_required: input.verificationRequired,
    approval_required: governance.approval_gate.approval_required,
    approval_status: governance.approval_gate.status,
    handoff_ready: missingArtifacts.length === 0,
    summary: input.verificationRequired
      ? "independent verifier evidence and a recorded human approval are required before promotion"
      : "runtime completed without an independent verifier or approval requirement",
    commands: ["npm run runtime:fixture", "npm run typecheck", "npm test"],
    artifacts,
    missing_artifacts: missingArtifacts,
  };
}

function buildGovernanceEvidence(input: {
  envelope: TaskEnvelope;
  outcome: HeartbeatOutcome;
}): GovernanceEvidence {
  const approvalRequired = input.envelope.verification_required;
  const approvalStatus: ApprovalGateStatus = !approvalRequired
    ? "not_required"
    : input.outcome === HeartbeatOutcome.Blocked
      ? "blocked_by_recovery"
      : "pending_human_approval";
  const approvalArtifactPath = approvalRequired
    ? "state://verification_handoff/governance/approval_gate"
    : null;
  const inputDefense = input.envelope.inputs.map(buildInputDefenseEvidence);
  const auditTrail: GovernanceAuditEntry[] = [
    {
      event: "approval_gate_declared",
      path: "state://verification_handoff/governance/approval_gate",
      detail: approvalRequired
        ? "promotion requires a recorded human approval artifact"
        : "approval gate not required for this envelope",
    },
    {
      event: "input_boundary_recorded",
      path: "state://verification_handoff/governance/input_defense",
      detail: "input trust boundaries were recorded before promotion",
    },
  ];

  if (approvalStatus === "pending_human_approval") {
    auditTrail.push({
      event: "promotion_blocked",
      path: "state://status",
      detail: "runtime remains in done_candidate until approval:grant is satisfied",
    });
  }

  if (approvalStatus === "blocked_by_recovery") {
    auditTrail.push({
      event: "rollback_recorded",
      path: "state://recovery",
      detail: "approval action is deferred until rollback and requeue review completes",
    });
  }

  return {
    approval_gate: {
      policy_id: "human_approval_required_for_promotion",
      approval_required: approvalRequired,
      status: approvalStatus,
      approver_role: "human_operator",
      artifact_path: approvalArtifactPath,
      promotion_blocked: approvalStatus === "pending_human_approval",
      rationale: approvalRequired
        ? input.outcome === HeartbeatOutcome.Blocked
          ? "Execution failed, so approval remains unavailable until recovery evidence is reviewed."
          : "Execution reached done_candidate, but promotion stays closed until a human operator records approval."
        : "This envelope does not require a separate human approval gate.",
    },
    authorization_boundary: {
      promotion_action: "promote_done_candidate_to_complete",
      required_permission: "approval:grant",
      allowed: !approvalRequired,
      exception: approvalRequired
        ? "promotion to complete is denied without a recorded human approval artifact and approval:grant permission"
        : null,
    },
    input_defense: inputDefense,
    audit_trail: auditTrail,
  };
}

function buildInputDefenseEvidence(input: {
  kind: TaskInputKind;
  ref: string;
}): InputDefenseEvidence {
  switch (input.kind) {
    case TaskInputKind.File:
      return {
        input_ref: input.ref,
        input_kind: input.kind,
        trust_zone: "trusted_workspace",
        handling_rule: "workspace file inputs stay inside the repo adapter and still require verification before promotion",
      };
    case TaskInputKind.StateSnapshot:
      return {
        input_ref: input.ref,
        input_kind: input.kind,
        trust_zone: "trusted_runtime_state",
        handling_rule: "state snapshots may inform execution, but promotion still follows verification and approval gates",
      };
    case TaskInputKind.Issue:
    case TaskInputKind.ExternalNote:
    case TaskInputKind.Other:
      return {
        input_ref: input.ref,
        input_kind: input.kind,
        trust_zone: "untrusted_external_input",
        handling_rule: "external text is treated as data only and cannot satisfy promotion or authorization checks by itself",
      };
  }
}

function buildStateSyncOperations(
  current: CanonicalState,
  target: CanonicalState,
): StateOperation[] {
  return diffRecord(current, target, "");
}

function diffRecord(
  current: Record<string, unknown>,
  target: Record<string, unknown>,
  basePath: string,
): StateOperation[] {
  const operations: StateOperation[] = [];

  for (const key of Object.keys(current)) {
    if (!(key in target)) {
      operations.push({
        op: PatchOperation.Remove,
        path: `${basePath}/${encodePointerToken(key)}`,
        value: null,
      });
    }
  }

  for (const [key, targetValue] of Object.entries(target)) {
    const path = `${basePath}/${encodePointerToken(key)}`;
    const currentValue = current[key];

    if (!(key in current)) {
      operations.push({
        op: PatchOperation.Add,
        path,
        value: targetValue,
      });
      continue;
    }

    if (isPlainRecord(currentValue) && isPlainRecord(targetValue)) {
      operations.push(...diffRecord(currentValue, targetValue, path));
      continue;
    }

    if (!isDeepEqual(currentValue, targetValue)) {
      operations.push({
        op: PatchOperation.Replace,
        path,
        value: targetValue,
      });
    }
  }

  return operations;
}

function encodePointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
