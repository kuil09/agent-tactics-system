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
  contract_version: "m5";
  subject_id: string;
  executor_provider_id: string;
  executor_provider_kind: ProviderKind;
  executor_model: string;
  outcome: HeartbeatOutcome;
  rollback_to_version: number | null;
  replay: VerificationReplaySummary;
  evidence: VerificationEvidenceBundle;
  approval_workflow: ApprovalWorkflowHandoff;
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
    | "approval_request"
    | "recovery_record"
    | "approval_record";
  path: string;
  required: boolean;
  status: "present" | "pending";
}

export interface ApprovalWorkflowHandoff {
  workflow_id: string;
  status: ApprovalGateStatus;
  request: ApprovalRequestHandoff;
  decision: ApprovalDecisionHandoff;
  release: ApprovalReleaseHandoff;
}

export interface ApprovalRequestHandoff {
  requested_role: "human_operator";
  request_channel: "handoff_artifact";
  request_artifact_path: string | null;
  issued_at: string | null;
  summary: string;
  required_evidence: string[];
  validation_commands: string[];
}

export interface ApprovalDecisionHandoff {
  status: ApprovalGateStatus;
  decision_artifact_path: string | null;
  recorded_by: string | null;
  recorded_at: string | null;
  resolution_criteria: string[];
  blocked_reason: string | null;
}

export interface ApprovalReleaseHandoff {
  promotion_action: "promote_done_candidate_to_complete";
  release_blocked: boolean;
  blockers: string[];
  unblock_checklist: string[];
  next_owner: "human_operator" | "system_orchestrator";
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
    | "approval_workflow_declared"
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
  scope: RuntimeRecoveryScope;
  steps: RuntimeRecoveryStep[];
}

export interface RuntimeRecoveryScope {
  attempted_write_paths: string[];
  changed_paths: string[];
  modified_preexisting_paths: string[];
  created_paths: string[];
  restored_paths: string[];
  unrestored_paths: string[];
  artifact_paths_missing_after_recovery: string[];
  residual_risk_paths: string[];
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
  const observedRepo = new ObservedRepoAdapter(input.repo);

  try {
    const executed = await executeTaskEnvelope({
      envelope: input.envelope,
      provider: input.provider,
      repo: observedRepo,
      skill_loader: input.skill_loader,
      required_skill_ids: input.required_skill_ids,
    });
    const governance = buildGovernanceEvidence({
      envelope: input.envelope,
      outcome: HeartbeatOutcome.Patched,
    });
    const approvalWorkflow = buildApprovalWorkflowHandoff({
      heartbeat: input.heartbeat,
      envelope: input.envelope,
      outcome: HeartbeatOutcome.Patched,
    });

    const verificationHandoff: VerificationHandoff = {
      contract_version: "m5",
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
      approval_workflow: approvalWorkflow,
      governance,
      recovery: {
        attempted: false,
        outcome_classification: "not_needed",
        strategy: "none",
        rollback_to_version: issuedPatch.version,
        repo_restored: false,
        requeued: false,
        reason: null,
        scope: {
          attempted_write_paths: observedRepo.getWrittenPaths(),
          changed_paths: [],
          modified_preexisting_paths: [],
          created_paths: [],
          restored_paths: [],
          unrestored_paths: [],
          artifact_paths_missing_after_recovery: [],
          residual_risk_paths: [],
        },
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
    const attemptedWritePaths = observedRepo.getWrittenPaths();
    let changedPaths = attemptedWritePaths;
    let modifiedPreexistingPaths: string[] = [];
    let createdPaths: string[] = [];
    let repoRestored = false;
    let restoredPaths: string[] = [];
    let unrestoredPaths = changedPaths;
    let failedRepoSnapshot: unknown = null;
    let recoveredRepoSnapshot: unknown = null;

    if (repoSnapshot !== null && isSnapshotCapableRepoAdapter(input.repo)) {
      failedRepoSnapshot = await input.repo.createSnapshot();
      changedPaths = collectChangedRepoPaths(repoSnapshot, failedRepoSnapshot);
      modifiedPreexistingPaths = changedPaths.filter((path) =>
        pathExistsInSnapshot(repoSnapshot, path),
      );
      createdPaths = changedPaths.filter(
        (path) =>
          !pathExistsInSnapshot(repoSnapshot, path) &&
          pathExistsInSnapshot(failedRepoSnapshot, path),
      );
      await input.repo.restoreSnapshot(repoSnapshot);
      repoRestored = true;

      recoveredRepoSnapshot = await input.repo.createSnapshot();
      restoredPaths = changedPaths.filter((path) =>
        repoFileContentEquals(repoSnapshot, recoveredRepoSnapshot, path),
      );
      unrestoredPaths = changedPaths.filter(
        (path) => !restoredPaths.includes(path),
      );
    }

    const artifactPathsMissingAfterRecovery = changedPaths.filter(
      (path) =>
        path.startsWith("artifacts/") &&
        !pathExistsInSnapshot(repoSnapshot, path) &&
        !pathExistsInSnapshot(recoveredRepoSnapshot, path),
    );
    const residualRiskPaths = sortUniquePaths([
      ...unrestoredPaths,
      ...artifactPathsMissingAfterRecovery,
    ]);

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
      scope: {
        attempted_write_paths: attemptedWritePaths,
        changed_paths: changedPaths,
        modified_preexisting_paths: modifiedPreexistingPaths,
        created_paths: createdPaths,
        restored_paths: restoredPaths,
        unrestored_paths: unrestoredPaths,
        artifact_paths_missing_after_recovery: artifactPathsMissingAfterRecovery,
        residual_risk_paths: residualRiskPaths,
      },
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
    const approvalWorkflow = buildApprovalWorkflowHandoff({
      heartbeat: input.heartbeat,
      envelope: input.envelope,
      outcome: HeartbeatOutcome.Blocked,
    });
    const verificationHandoff: VerificationHandoff = {
      contract_version: "m5",
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
      approval_workflow: approvalWorkflow,
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
  const approvalWorkflow = buildApprovalWorkflowHandoff({
    heartbeat: null,
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
      label: "approval workflow request",
      kind: "approval_request",
      path: "state://verification_handoff/approval_workflow/request",
      required: governance.approval_gate.approval_required,
      status: governance.approval_gate.approval_required ? "present" : "pending",
    },
    {
      label: "approval gate record",
      kind: "approval_record",
      path: "state://verification_handoff/approval_workflow/decision",
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
    approval_required: approvalWorkflow.status !== "not_required",
    approval_status: approvalWorkflow.status,
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
      event: "approval_workflow_declared",
      path: "state://verification_handoff/approval_workflow",
      detail: approvalRequired
        ? "approval handoff records the request, decision, and release criteria"
        : "approval workflow handoff is not required for this envelope",
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

function buildApprovalWorkflowHandoff(input: {
  heartbeat: HeartbeatRecord | null;
  envelope: TaskEnvelope;
  outcome: HeartbeatOutcome;
}): ApprovalWorkflowHandoff {
  const approvalRequired = input.envelope.verification_required;
  const status: ApprovalGateStatus = !approvalRequired
    ? "not_required"
    : input.outcome === HeartbeatOutcome.Blocked
      ? "blocked_by_recovery"
      : "pending_human_approval";
  const requestArtifactPath = approvalRequired
    ? "state://verification_handoff/approval_workflow/request"
    : null;
  const decisionArtifactPath = approvalRequired
    ? "state://verification_handoff/approval_workflow/decision"
    : null;

  return {
    workflow_id: `approval-${input.heartbeat?.issue_id ?? "runtime"}`,
    status,
    request: {
      requested_role: "human_operator",
      request_channel: "handoff_artifact",
      request_artifact_path: requestArtifactPath,
      issued_at: input.heartbeat?.finished_at ?? input.heartbeat?.started_at ?? null,
      summary: approvalRequired
        ? "Review the execution evidence, confirm the trust boundaries, and record a promotion decision."
        : "No separate approval request is required for this envelope.",
      required_evidence: approvalRequired
        ? [
            "state://verification_handoff/replay",
            "workspace://artifacts/runtime.log",
            "state://verification_handoff/governance/input_defense",
          ]
        : [],
      validation_commands: approvalRequired
        ? ["npm run runtime:fixture", "npm run typecheck", "npm test"]
        : [],
    },
    decision: {
      status,
      decision_artifact_path: decisionArtifactPath,
      recorded_by: null,
      recorded_at: null,
      resolution_criteria: approvalRequired
        ? [
            "verification replay remains in pass status",
            "an authorized operator records the approval decision",
            "promotion is retried with approval:grant permission",
          ]
        : [],
      blocked_reason:
        status === "pending_human_approval"
          ? "human approval has not been recorded yet"
          : status === "blocked_by_recovery"
            ? "execution failed, so approval stays blocked until rollback evidence is reviewed"
            : null,
    },
    release: {
      promotion_action: "promote_done_candidate_to_complete",
      release_blocked: status !== "not_required",
      blockers:
        status === "pending_human_approval"
          ? ["human approval artifact missing", "approval:grant permission missing"]
          : status === "blocked_by_recovery"
            ? ["rollback review incomplete", "issue must be rerun successfully"]
            : [],
      unblock_checklist:
        status === "pending_human_approval"
          ? [
              "record the approval decision artifact",
              "confirm independent verification evidence still passes",
              "rerun promotion with approval:grant",
            ]
          : status === "blocked_by_recovery"
            ? [
                "review rollback and missing artifact evidence",
                "rerun the issue successfully",
                "reissue the approval request after recovery",
              ]
            : [],
      next_owner: status === "not_required" ? "system_orchestrator" : "human_operator",
    },
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

class ObservedRepoAdapter implements RepoAdapter {
  private readonly writtenPaths = new Set<string>();

  constructor(private readonly delegate: RepoAdapter) {}

  read(path: string): Promise<string> | string {
    return this.delegate.read(path);
  }

  write(path: string, content: string): Promise<void> | void {
    this.writtenPaths.add(path);
    return this.delegate.write(path, content);
  }

  getWrittenPaths(): string[] {
    return [...this.writtenPaths];
  }
}

function collectChangedRepoPaths(
  previousSnapshot: unknown,
  nextSnapshot: unknown,
): string[] {
  const previous = coerceRepoSnapshot(previousSnapshot);
  const next = coerceRepoSnapshot(nextSnapshot);
  const paths = new Set<string>([
    ...Object.keys(previous),
    ...Object.keys(next),
  ]);

  return [...paths].filter((path) => previous[path] !== next[path]).sort();
}

function coerceRepoSnapshot(snapshot: unknown): Record<string, string> {
  if (typeof snapshot !== "object" || snapshot === null) {
    return {};
  }

  const record: Record<string, string> = {};

  for (const [path, content] of Object.entries(snapshot)) {
    if (typeof content === "string") {
      record[path] = content;
    }
  }

  return record;
}

function repoFileContentEquals(
  leftSnapshot: unknown,
  rightSnapshot: unknown,
  path: string,
): boolean {
  const left = coerceRepoSnapshot(leftSnapshot);
  const right = coerceRepoSnapshot(rightSnapshot);

  return left[path] === right[path];
}

function pathExistsInSnapshot(snapshot: unknown, path: string): boolean {
  const record = coerceRepoSnapshot(snapshot);
  return path in record;
}

function sortUniquePaths(paths: string[]): string[] {
  return [...new Set(paths)].sort();
}
