import { describe, expect, it } from "vitest";

import {
  HeartbeatOutcome,
  PatchOperation,
  ProviderKind,
  SideEffectLevel,
  TaskInputKind,
  TaskLevel,
  VerificationStatus,
  VerificationSubjectKind,
} from "../../src/contracts/enums.js";
import type { HeartbeatRecord, TaskEnvelope } from "../../src/contracts/types.js";
import { InMemoryRepoAdapter } from "../../src/adapters/repo/index.js";
import { StateStore } from "../../src/orchestrator/state-store.js";
import { StaticSkillLoader } from "../../src/skills/loader.js";
import { runExecutableRuntime } from "../../src/runtime/executable-runtime.js";

describe("programmatic executable runtime", () => {
  it("wires heartbeat issuance, task execution, and verification handoff through the orchestrator", async () => {
    const repo = new InMemoryRepoAdapter({
      "src/task.txt": "wire runtime",
    });
    const loader = new StaticSkillLoader([
      {
        contract: {
          skill_id: "runtime-writer",
          purpose: "Write runtime changes",
          preconditions: ["repo is available"],
          allowed_roles: ["engineer"],
          allowed_targets: ["src", "artifacts", "tests"],
          side_effect_level: SideEffectLevel.WriteLocal,
          requires_lock: false,
          verification_required: true,
          failure_recovery: ["rerun runtime fixture"],
        },
        source: "fixture",
      },
    ]);
    const heartbeat: HeartbeatRecord = {
      record_id: "hb-1",
      agent_id: "agent-1",
      issue_id: "issue-1",
      turn_number: 3,
      inputs_summary: "Continue executable runtime slice",
      allowed_action_budget: {
        tool_calls: 8,
        write_ops: 3,
      },
      started_at: "2026-03-30T12:00:00Z",
      finished_at: "2026-03-30T12:02:00Z",
      outcome: HeartbeatOutcome.Noop,
    };
    const envelope: TaskEnvelope = {
      objective: "Connect heartbeat records to the runtime entrypoint",
      task_level: TaskLevel.L3,
      inputs: [
        {
          kind: TaskInputKind.File,
          ref: "src/task.txt",
        },
      ],
      allowed_tools: ["rg", "vitest"],
      write_scope: ["src", "tests", "artifacts"],
      must_not: ["modify docs/architecture.md"],
      done_when: ["runtime fixture passes"],
      stop_conditions: ["missing skill"],
      output_schema_ref: "schemas/verification-record.schema.json",
      verification_required: true,
      rollback_hint: "remove artifacts/runtime.log",
    };

    const result = await runExecutableRuntime({
      heartbeat,
      envelope,
      repo,
      skill_loader: loader,
      required_skill_ids: ["runtime-writer"],
      verification_records: [
        {
          verification_id: "verify-prev",
          subject_id: "issue-1",
          subject_kind: VerificationSubjectKind.Task,
          verifier_provider_id: "claude-verify",
          verifier_model: "claude-sonnet-4",
          status: VerificationStatus.Pass,
          evidence: ["previous replay evidence"],
          created_at: "2026-03-29T23:00:00Z",
        },
      ],
      provider: {
        provider_id: "openai-runtime",
        provider_kind: ProviderKind.OpenAI,
        model_id: "gpt-5.4",
        async execute(request) {
          await request.repo.write(
            "artifacts/runtime.log",
            `${request.envelope.objective} :: ${request.inputs[0]?.content ?? "missing"}`,
          );

          return {
            provider_id: "openai-runtime",
            model_id: "gpt-5.4",
            summary: "executed runtime heartbeat turn",
          };
        },
      },
    });

    expect(result.issued).toMatchObject({
      version: 1,
      state: {
        status: "in_progress",
        heartbeat: {
          record_id: "hb-1",
          outcome: HeartbeatOutcome.Noop,
        },
      },
    });
    expect(result.completed).toMatchObject({
      version: 2,
      state: {
        status: "done_candidate",
        execution: {
          provider_id: "openai-runtime",
          model_id: "gpt-5.4",
          required_skill_ids: ["runtime-writer"],
        },
        heartbeat: {
          record_id: "hb-1",
          outcome: HeartbeatOutcome.Patched,
        },
      },
    });
    expect(result.verification_handoff).toEqual({
      subject_id: "issue-1",
      executor_provider_id: "openai-runtime",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      outcome: HeartbeatOutcome.Patched,
      rollback_to_version: 1,
      replay: {
        subject_id: "issue-1",
        verification_ids: ["verify-prev"],
        evidence: ["previous replay evidence"],
        latest_status: VerificationStatus.Pass,
        latest_created_at: "2026-03-29T23:00:00Z",
        status_counts: {
          pending: 0,
          pass: 1,
          fail: 0,
          requeue: 0,
        },
        recovery_paths: [],
        timeline: [
          {
            verification_id: "verify-prev",
            status: VerificationStatus.Pass,
            evidence: ["previous replay evidence"],
            created_at: "2026-03-29T23:00:00Z",
          },
        ],
      },
      recovery: {
        attempted: false,
        strategy: "none",
        rollback_to_version: 1,
        repo_restored: false,
        requeued: false,
        reason: null,
      },
    });
    expect(await repo.read("artifacts/runtime.log")).toBe(
      "Connect heartbeat records to the runtime entrypoint :: wire runtime",
    );
  });

  it("rolls back repo state and requeues the issue when execution fails", async () => {
    const repo = new InMemoryRepoAdapter({
      "src/task.txt": "rollback runtime",
    });
    const loader = new StaticSkillLoader([
      {
        contract: {
          skill_id: "runtime-writer",
          purpose: "Write runtime changes",
          preconditions: ["repo is available"],
          allowed_roles: ["engineer"],
          allowed_targets: ["src", "artifacts", "tests"],
          side_effect_level: SideEffectLevel.WriteLocal,
          requires_lock: false,
          verification_required: true,
          failure_recovery: ["rerun runtime fixture"],
        },
        source: "fixture",
      },
    ]);
    const heartbeat: HeartbeatRecord = {
      record_id: "hb-2",
      agent_id: "agent-1",
      issue_id: "issue-rollback",
      turn_number: 4,
      inputs_summary: "Replay rollback flow",
      allowed_action_budget: {
        tool_calls: 8,
        write_ops: 3,
      },
      started_at: "2026-03-30T12:10:00Z",
      finished_at: "2026-03-30T12:12:00Z",
      outcome: HeartbeatOutcome.Noop,
    };
    const envelope: TaskEnvelope = {
      objective: "Exercise runtime rollback and requeue",
      task_level: TaskLevel.L3,
      inputs: [
        {
          kind: TaskInputKind.File,
          ref: "src/task.txt",
        },
      ],
      allowed_tools: ["rg", "vitest"],
      write_scope: ["src", "tests", "artifacts"],
      must_not: ["modify docs/architecture.md"],
      done_when: ["runtime fixture passes"],
      stop_conditions: ["missing skill"],
      output_schema_ref: "schemas/verification-record.schema.json",
      verification_required: true,
      rollback_hint: "remove artifacts/runtime.log",
    };

    const result = await runExecutableRuntime({
      heartbeat,
      envelope,
      repo,
      skill_loader: loader,
      required_skill_ids: ["runtime-writer"],
      verification_records: [
        {
          verification_id: "verify-fail",
          subject_id: "issue-rollback",
          subject_kind: VerificationSubjectKind.Task,
          verifier_provider_id: "claude-verify",
          verifier_model: "claude-sonnet-4",
          status: VerificationStatus.Fail,
          evidence: ["verification rejected execution"],
          created_at: "2026-03-30T12:09:00Z",
        },
        {
          verification_id: "verify-requeue",
          subject_id: "issue-rollback",
          subject_kind: VerificationSubjectKind.Task,
          verifier_provider_id: "claude-verify",
          verifier_model: "claude-sonnet-4",
          status: VerificationStatus.Requeue,
          evidence: ["requeue after rollback"],
          created_at: "2026-03-30T12:09:30Z",
        },
      ],
      provider: {
        provider_id: "openai-runtime",
        provider_kind: ProviderKind.OpenAI,
        model_id: "gpt-5.4",
        async execute(request) {
          await request.repo.write("artifacts/runtime.log", "transient execution");
          throw new Error("verification replay requested rollback");
        },
      },
    });

    expect(result.completed).toMatchObject({
      version: 3,
      state: {
        status: "queued",
        execution_error: {
          message: "verification replay requested rollback",
        },
        recovery: {
          attempted: true,
          strategy: "rollback_and_requeue",
          rollback_to_version: 0,
          repo_restored: true,
          requeued: true,
          reason: "verification replay requested rollback",
        },
        heartbeat: {
          record_id: "hb-2",
          outcome: HeartbeatOutcome.Blocked,
        },
      },
    });
    expect(result.recovered).toEqual(result.completed);
    expect(result.verification_handoff).toEqual({
      subject_id: "issue-rollback",
      executor_provider_id: "openai-runtime",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      outcome: HeartbeatOutcome.Blocked,
      rollback_to_version: 0,
      replay: {
        subject_id: "issue-rollback",
        verification_ids: ["verify-fail", "verify-requeue"],
        evidence: ["verification rejected execution", "requeue after rollback"],
        latest_status: VerificationStatus.Requeue,
        latest_created_at: "2026-03-30T12:09:30Z",
        status_counts: {
          pending: 0,
          pass: 0,
          fail: 1,
          requeue: 1,
        },
        recovery_paths: ["rollback", "requeue"],
        timeline: [
          {
            verification_id: "verify-fail",
            status: VerificationStatus.Fail,
            evidence: ["verification rejected execution"],
            created_at: "2026-03-30T12:09:00Z",
          },
          {
            verification_id: "verify-requeue",
            status: VerificationStatus.Requeue,
            evidence: ["requeue after rollback"],
            created_at: "2026-03-30T12:09:30Z",
          },
        ],
      },
      recovery: {
        attempted: true,
        strategy: "rollback_and_requeue",
        rollback_to_version: 0,
        repo_restored: true,
        requeued: true,
        reason: "verification replay requested rollback",
      },
    });
    expect(() => repo.read("artifacts/runtime.log")).toThrow(
      "repo path not found: artifacts/runtime.log",
    );
  });

  it("requeues without repo snapshot restoration and syncs mutated state back to the issued snapshot", async () => {
    const stateStore = new StateStore<Record<string, unknown>>({
      status: "queued",
      stale: true,
      nested: {
        keep: "yes",
      },
    });
    const heartbeat: HeartbeatRecord = {
      record_id: "hb-3",
      agent_id: "agent-1",
      issue_id: "issue-nosnapshot",
      turn_number: 5,
      inputs_summary: "Replay no-snapshot rollback flow",
      allowed_action_budget: {
        tool_calls: 4,
        write_ops: 2,
      },
      started_at: "2026-03-30T12:20:00Z",
      finished_at: "2026-03-30T12:21:00Z",
      outcome: HeartbeatOutcome.Noop,
    };
    const envelope: TaskEnvelope = {
      objective: "Exercise state sync rollback without repo snapshots",
      task_level: TaskLevel.L2,
      inputs: [],
      allowed_tools: ["rg"],
      write_scope: ["src"],
      must_not: [],
      done_when: ["state restored"],
      stop_conditions: ["provider failure"],
      output_schema_ref: "schemas/verification-record.schema.json",
      verification_required: false,
      rollback_hint: "none",
    };

    const result = await runExecutableRuntime({
      heartbeat,
      envelope,
      state_store: stateStore,
      repo: {
        read() {
          throw new Error("repo reads are not expected");
        },
        write() {},
      },
      skill_loader: new StaticSkillLoader([]),
      provider: {
        provider_id: "fallback-runtime",
        model_id: "fallback-model",
        async execute() {
          stateStore.applyPatch({
            patch_id: "out-of-band-mutation",
            issue_id: "issue-nosnapshot",
            actor_id: "agent-side-effect",
            base_state_version: stateStore.getSnapshot().version,
            operations: [
              {
                op: PatchOperation.Replace,
                path: "/status",
                value: "mutated",
              },
              {
                op: PatchOperation.Remove,
                path: "/stale",
                value: null,
              },
              {
                op: PatchOperation.Add,
                path: "/nested/extra",
                value: "temporary",
              },
              {
                op: PatchOperation.Add,
                path: "/ephemeral",
                value: true,
              },
            ],
            requires_lock: true,
            verifier_required: false,
            rollback_to_version: 1,
          });

          throw new Error("provider execution failed without snapshot support");
        },
      },
    });

    expect(result.completed.state).toMatchObject({
      status: "queued",
      stale: true,
      nested: {
        keep: "yes",
      },
      execution_error: {
        message: "provider execution failed without snapshot support",
      },
      recovery: {
        attempted: true,
        strategy: "rollback_and_requeue",
        repo_restored: false,
      },
    });
    expect(result.completed.state).not.toHaveProperty("ephemeral");
    expect(result.verification_handoff.executor_provider_kind).toBe(ProviderKind.Other);
  });

  it("completes immediately when verification is not required and no skills are requested", async () => {
    const repo = new InMemoryRepoAdapter({});
    const heartbeat: HeartbeatRecord = {
      record_id: "hb-4",
      agent_id: "agent-1",
      issue_id: "issue-complete",
      turn_number: 6,
      inputs_summary: "Run immediate completion flow",
      allowed_action_budget: {
        tool_calls: 2,
        write_ops: 1,
      },
      started_at: "2026-03-30T12:30:00Z",
      finished_at: "2026-03-30T12:31:00Z",
      outcome: HeartbeatOutcome.Noop,
    };
    const envelope: TaskEnvelope = {
      objective: "Complete without verification handoff delay",
      task_level: TaskLevel.L1,
      inputs: [],
      allowed_tools: ["rg"],
      write_scope: ["src"],
      must_not: [],
      done_when: ["state updated"],
      stop_conditions: [],
      output_schema_ref: "schemas/verification-record.schema.json",
      verification_required: false,
      rollback_hint: "none",
    };

    const result = await runExecutableRuntime({
      heartbeat,
      envelope,
      repo,
      skill_loader: new StaticSkillLoader([]),
      provider: {
        provider_id: "fallback-runtime",
        model_id: "fallback-model",
        async execute() {
          return {
            provider_id: "fallback-runtime",
            model_id: "fallback-model",
            summary: "completed immediately",
          };
        },
      },
    });

    expect(result.completed.state).toMatchObject({
      status: "complete",
      execution: {
        provider_id: "fallback-runtime",
        model_id: "fallback-model",
        summary: "completed immediately",
        required_skill_ids: [],
      },
    });
    expect(result.verification_handoff.replay).toEqual({
      subject_id: "issue-complete",
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
    });
    expect(result.verification_handoff.executor_provider_kind).toBe(ProviderKind.Other);
  });

  it("captures non-Error failures during runtime execution", async () => {
    const result = await runExecutableRuntime({
      heartbeat: {
        record_id: "hb-5",
        agent_id: "agent-1",
        issue_id: "issue-string-error",
        turn_number: 7,
        inputs_summary: "Replay string failure",
        allowed_action_budget: {
          tool_calls: 2,
          write_ops: 1,
        },
        started_at: "2026-03-30T12:40:00Z",
        finished_at: "2026-03-30T12:41:00Z",
        outcome: HeartbeatOutcome.Noop,
      },
      envelope: {
        objective: "Handle string failure",
        task_level: TaskLevel.L1,
        inputs: [],
        allowed_tools: ["rg"],
        write_scope: ["src"],
        must_not: [],
        done_when: [],
        stop_conditions: [],
        output_schema_ref: "schemas/verification-record.schema.json",
        verification_required: false,
        rollback_hint: "none",
      },
      repo: new InMemoryRepoAdapter({}),
      skill_loader: new StaticSkillLoader([]),
      provider: {
        provider_id: "fallback-runtime",
        model_id: "fallback-model",
        execute() {
          throw "string failure";
        },
      },
    });

    expect(result.completed.state).toMatchObject({
      execution_error: {
        message: "string failure",
      },
    });
  });
});
