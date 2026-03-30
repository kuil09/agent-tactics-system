import { HeartbeatOutcome, PatchOperation, ProviderKind } from "../contracts/enums.js";
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
  recovery?: RuntimeRecoveryState;
  execution_error?: {
    message: string;
  };
}

export interface VerificationHandoff {
  subject_id: string;
  executor_provider_id: string;
  executor_provider_kind: ProviderKind;
  executor_model: string;
  outcome: HeartbeatOutcome;
  rollback_to_version: number | null;
  replay: VerificationReplaySummary;
  recovery: RuntimeRecoveryState;
}

export interface RuntimeRecoveryState {
  attempted: boolean;
  strategy: "none" | "rollback_and_requeue";
  rollback_to_version: number | null;
  repo_restored: boolean;
  requeued: boolean;
  reason: string | null;
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

    const verificationHandoff: VerificationHandoff = {
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
      recovery: {
        attempted: false,
        strategy: "none",
        rollback_to_version: issuedPatch.version,
        repo_restored: false,
        requeued: false,
        reason: null,
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
      strategy: "rollback_and_requeue",
      rollback_to_version: executionRollbackVersion,
      repo_restored: repoRestored,
      requeued: true,
      reason: message,
    };
    const verificationHandoff: VerificationHandoff = {
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
