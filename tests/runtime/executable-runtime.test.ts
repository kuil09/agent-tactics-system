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
        write_ops: 5,
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
        {
          kind: TaskInputKind.ExternalNote,
          ref: "browser://operator-approval-request",
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
        governance: {
          approval_gate: {
            status: "pending_human_approval",
            promotion_blocked: true,
          },
        },
      },
    });
    expect(result.verification_handoff).toMatchObject({
      contract_version: "m5",
      subject_id: "issue-1",
      executor_provider_id: "openai-runtime",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      outcome: HeartbeatOutcome.Patched,
      rollback_to_version: 1,
      evidence: {
        verification_required: true,
        independent_verifier_required: true,
        approval_required: true,
        approval_status: "pending_human_approval",
        handoff_ready: true,
        commands: ["npm run runtime:fixture", "npm run typecheck", "npm test"],
        missing_artifacts: [],
      },
      approval_workflow: {
        workflow_id: "approval-issue-1",
        status: "pending_human_approval",
        request: {
          request_artifact_path: "state://verification_handoff/approval_workflow/request",
        },
        decision: {
          decision_artifact_path: "state://verification_handoff/approval_workflow/decision",
          blocked_reason: "human approval has not been recorded yet",
        },
        release: {
          release_blocked: true,
          next_owner: "human_operator",
        },
      },
      governance: {
        approval_gate: {
          status: "pending_human_approval",
          approver_role: "human_operator",
          promotion_blocked: true,
        },
        authorization_boundary: {
          required_permission: "approval:grant",
          allowed: false,
        },
      },
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
        outcome_classification: "not_needed",
        strategy: "none",
        rollback_to_version: 1,
        repo_restored: false,
        requeued: false,
        reason: null,
        scope: {
          attempted_write_paths: ["artifacts/runtime.log"],
          changed_paths: [],
          modified_preexisting_paths: [],
          created_paths: [],
          restored_paths: [],
          unrestored_paths: [],
          artifact_paths_missing_after_recovery: [],
          residual_risk_paths: [],
        },
      },
    });
    expect(result.verification_handoff.evidence.artifacts).toEqual([
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
        required: true,
        status: "present",
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
        required: true,
        status: "present",
      },
      {
        label: "approval gate record",
        kind: "approval_record",
        path: "state://verification_handoff/approval_workflow/decision",
        required: true,
        status: "present",
      },
      {
        label: "recovery record",
        kind: "recovery_record",
        path: "state://recovery",
        required: false,
        status: "pending",
      },
    ]);
    expect(result.verification_handoff.governance.input_defense).toEqual([
      {
        input_ref: "src/task.txt",
        input_kind: TaskInputKind.File,
        trust_zone: "trusted_workspace",
        handling_rule:
          "workspace file inputs stay inside the repo adapter and still require verification before promotion",
      },
      {
        input_ref: "browser://operator-approval-request",
        input_kind: TaskInputKind.ExternalNote,
        trust_zone: "untrusted_external_input",
        handling_rule:
          "external text is treated as data only and cannot satisfy promotion or authorization checks by itself",
      },
    ]);
    expect(result.verification_handoff.recovery.steps).toEqual([
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
    ]);
    expect(await repo.read("artifacts/runtime.log")).toBe(
      "Connect heartbeat records to the runtime entrypoint :: wire runtime",
    );
  });

  it("rolls back repo state and requeues the issue when execution fails", async () => {
    const repo = new InMemoryRepoAdapter({
      "src/task.txt": "rollback runtime",
      "artifacts/seed-state.json": JSON.stringify(
        {
          scenario: "failure",
          baseline: true,
        },
        null,
        2,
      ),
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
        write_ops: 5,
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
          await request.repo.write(
            "artifacts/seed-state.json",
            JSON.stringify(
              {
                status: "mutated-before-rollback",
              },
              null,
              2,
            ),
          );
          await request.repo.write(
            "artifacts/partial-output.json",
            JSON.stringify(
              {
                status: "partial",
              },
              null,
              2,
            ),
          );
          await request.repo.write(
            "src/task.txt",
            "rollback runtime :: provider modified input before failing\n",
          );
          await request.repo.write(
            "src/generated.ts",
            "export const generatedDuringFailure = true;\n",
          );
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
    expect(result.verification_handoff).toMatchObject({
      contract_version: "m5",
      subject_id: "issue-rollback",
      executor_provider_id: "openai-runtime",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      outcome: HeartbeatOutcome.Blocked,
      rollback_to_version: 0,
      evidence: {
        verification_required: true,
        independent_verifier_required: true,
        approval_required: true,
        approval_status: "blocked_by_recovery",
        handoff_ready: true,
        missing_artifacts: [],
      },
      approval_workflow: {
        workflow_id: "approval-issue-rollback",
        status: "blocked_by_recovery",
        decision: {
          blocked_reason:
            "execution failed, so approval stays blocked until rollback evidence is reviewed",
        },
        release: {
          release_blocked: true,
          next_owner: "human_operator",
        },
      },
      governance: {
        approval_gate: {
          status: "blocked_by_recovery",
        },
        authorization_boundary: {
          required_permission: "approval:grant",
          allowed: false,
        },
      },
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
        outcome_classification: "rolled_back_and_requeued",
        strategy: "rollback_and_requeue",
        rollback_to_version: 0,
        repo_restored: true,
        requeued: true,
        reason: "verification replay requested rollback",
        scope: {
          attempted_write_paths: [
            "artifacts/runtime.log",
            "artifacts/seed-state.json",
            "artifacts/partial-output.json",
            "src/task.txt",
            "src/generated.ts",
          ],
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
          unrestored_paths: [],
          artifact_paths_missing_after_recovery: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
          ],
          residual_risk_paths: [
            "artifacts/partial-output.json",
            "artifacts/runtime.log",
          ],
        },
      },
    });
    expect(result.verification_handoff.recovery.steps).toEqual([
      {
        step: "repo_restore",
        status: "completed",
        detail: "repository snapshot restored",
      },
      {
        step: "state_rollback",
        status: "completed",
        detail: "state restored to version 0",
      },
      {
        step: "issue_requeue",
        status: "completed",
        detail: "issue returned to queued state after failure",
      },
    ]);
    expect(() => repo.read("artifacts/runtime.log")).toThrow(
      "repo path not found: artifacts/runtime.log",
    );
    expect(() => repo.read("artifacts/partial-output.json")).toThrow(
      "repo path not found: artifacts/partial-output.json",
    );
    expect(() => repo.read("src/generated.ts")).toThrow(
      "repo path not found: src/generated.ts",
    );
    expect(repo.read("src/task.txt")).toBe("rollback runtime");
    expect(repo.read("artifacts/seed-state.json")).toBe(
      JSON.stringify(
        {
          scenario: "failure",
          baseline: true,
        },
        null,
        2,
      ),
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
      },
    });
    expect(result.completed.state).not.toHaveProperty("ephemeral");
    expect(result.verification_handoff.executor_provider_kind).toBe(ProviderKind.Other);
    expect(result.verification_handoff.evidence.approval_required).toBe(false);
    expect(result.verification_handoff.governance.authorization_boundary.allowed).toBe(true);
    expect(result.verification_handoff.recovery.scope).toEqual({
      attempted_write_paths: [],
      changed_paths: [],
      modified_preexisting_paths: [],
      created_paths: [],
      restored_paths: [],
      unrestored_paths: [],
      artifact_paths_missing_after_recovery: [],
      residual_risk_paths: [],
    });
  });

  it("tracks missing artifact recovery paths when snapshot restoration is unavailable", async () => {
    const result = await runExecutableRuntime({
      heartbeat: {
        record_id: "hb-3b",
        agent_id: "agent-1",
        issue_id: "issue-nosnapshot-artifact",
        turn_number: 5,
        inputs_summary: "Replay no-snapshot artifact rollback flow",
        allowed_action_budget: {
          tool_calls: 2,
          write_ops: 1,
        },
        started_at: "2026-03-30T12:22:00Z",
        finished_at: "2026-03-30T12:23:00Z",
        outcome: HeartbeatOutcome.Noop,
      },
      envelope: {
        objective: "Exercise artifact recovery reporting without repo snapshots",
        task_level: TaskLevel.L2,
        inputs: [],
        allowed_tools: ["rg"],
        write_scope: ["artifacts"],
        must_not: [],
        done_when: ["recovery evidence exists"],
        stop_conditions: ["provider failure"],
        output_schema_ref: "schemas/verification-record.schema.json",
        verification_required: false,
        rollback_hint: "none",
      },
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
        async execute(request) {
          await request.repo.write("artifacts/runtime.log", "transient execution");
          throw new Error("provider execution failed without snapshot support");
        },
      },
    });

    expect(result.completed.state).toMatchObject({
      status: "queued",
      recovery: {
        attempted: true,
        repo_restored: false,
        scope: {
          attempted_write_paths: ["artifacts/runtime.log"],
          changed_paths: ["artifacts/runtime.log"],
          modified_preexisting_paths: [],
          created_paths: [],
          restored_paths: [],
          unrestored_paths: ["artifacts/runtime.log"],
          artifact_paths_missing_after_recovery: ["artifacts/runtime.log"],
          residual_risk_paths: ["artifacts/runtime.log"],
        },
      },
    });
    expect(result.verification_handoff.recovery.scope).toEqual({
      attempted_write_paths: ["artifacts/runtime.log"],
      changed_paths: ["artifacts/runtime.log"],
      modified_preexisting_paths: [],
      created_paths: [],
      restored_paths: [],
      unrestored_paths: ["artifacts/runtime.log"],
      artifact_paths_missing_after_recovery: ["artifacts/runtime.log"],
      residual_risk_paths: ["artifacts/runtime.log"],
    });
  });

  it("falls back to a null approval timestamp when heartbeat timestamps are absent", async () => {
    const result = await runExecutableRuntime({
      heartbeat: {
        record_id: "hb-3c",
        agent_id: "agent-1",
        issue_id: "issue-null-timestamp",
        turn_number: 6,
        inputs_summary: "Run null timestamp approval flow",
        allowed_action_budget: {
          tool_calls: 1,
          write_ops: 0,
        },
        started_at: undefined as unknown as string,
        finished_at: null,
        outcome: HeartbeatOutcome.Noop,
      },
      envelope: {
        objective: "Exercise null approval timestamp fallback",
        task_level: TaskLevel.L1,
        inputs: [],
        allowed_tools: ["rg"],
        write_scope: ["src"],
        must_not: [],
        done_when: ["summary returned"],
        stop_conditions: [],
        output_schema_ref: "schemas/verification-record.schema.json",
        verification_required: false,
        rollback_hint: "none",
      },
      repo: new InMemoryRepoAdapter(),
      skill_loader: new StaticSkillLoader([]),
      provider: {
        provider_id: "fallback-runtime",
        model_id: "fallback-model",
        async execute() {
          return {
            provider_id: "fallback-runtime",
            model_id: "fallback-model",
            summary: "completed without timestamps",
          };
        },
      },
    });

    expect(result.verification_handoff.approval_workflow.request.issued_at).toBeNull();
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
      inputs: [
        {
          kind: TaskInputKind.StateSnapshot,
          ref: "snapshot-1",
        },
        {
          kind: TaskInputKind.Issue,
          ref: "issue://follow-up",
        },
        {
          kind: TaskInputKind.Other,
          ref: "other://observer-note",
        },
      ],
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
    expect(result.verification_handoff.evidence.approval_required).toBe(false);
    expect(result.verification_handoff.evidence.approval_status).toBe("not_required");
    expect(result.verification_handoff.governance.input_defense).toEqual([
      {
        input_ref: "snapshot-1",
        input_kind: TaskInputKind.StateSnapshot,
        trust_zone: "trusted_runtime_state",
        handling_rule:
          "state snapshots may inform execution, but promotion still follows verification and approval gates",
      },
      {
        input_ref: "issue://follow-up",
        input_kind: TaskInputKind.Issue,
        trust_zone: "untrusted_external_input",
        handling_rule:
          "external text is treated as data only and cannot satisfy promotion or authorization checks by itself",
      },
      {
        input_ref: "other://observer-note",
        input_kind: TaskInputKind.Other,
        trust_zone: "untrusted_external_input",
        handling_rule:
          "external text is treated as data only and cannot satisfy promotion or authorization checks by itself",
      },
    ]);
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
