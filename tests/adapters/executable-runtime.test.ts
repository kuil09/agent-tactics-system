import { describe, expect, it } from "vitest";

import {
  SideEffectLevel,
  TaskInputKind,
  TaskLevel,
} from "../../src/contracts/enums.js";
import type { TaskEnvelope } from "../../src/contracts/types.js";
import {
  executeTaskEnvelope,
  type ProviderExecutionRequest,
} from "../../src/adapters/provider-api/index.js";
import {
  InMemoryRepoAdapter,
  isSnapshotCapableRepoAdapter,
  materializeTaskInputs,
} from "../../src/adapters/repo/index.js";
import { StaticSkillLoader } from "../../src/skills/loader.js";

describe("executable runtime slice", () => {
  it("routes a task envelope through repo materialization, skill loading, and provider execution", async () => {
    const repo = new InMemoryRepoAdapter({
      "src/task.txt": "implement the runtime slice",
    });
    const loader = new StaticSkillLoader([
      {
        contract: {
          skill_id: "typescript-implementer",
          purpose: "Apply TypeScript changes safely",
          preconditions: ["workspace is available"],
          allowed_roles: ["engineer"],
          allowed_targets: ["src", "tests"],
          side_effect_level: SideEffectLevel.WriteLocal,
          requires_lock: false,
          verification_required: true,
          failure_recovery: ["re-run tests"],
        },
        source: "test-registry",
      },
    ]);

    const captured: ProviderExecutionRequest[] = [];
    const provider = {
      provider_id: "mock-provider",
      model_id: "mock-model",
      async execute(request: ProviderExecutionRequest) {
        captured.push(request);
        await request.repo.write("artifacts/run.txt", "runtime executed");

        return {
          provider_id: "mock-provider",
          model_id: "mock-model",
          summary: `executed ${request.inputs.length} inputs with ${request.skills.length} skills`,
        };
      },
    };

    const envelope: TaskEnvelope = {
      objective: "Implement the adapter boundary",
      task_level: TaskLevel.L3,
      inputs: [
        {
          kind: TaskInputKind.File,
          ref: "src/task.txt",
        },
        {
          kind: TaskInputKind.ExternalNote,
          ref: "note-1",
        },
      ],
      allowed_tools: ["rg", "vitest"],
      write_scope: ["src", "tests", "artifacts"],
      must_not: ["modify docs/architecture.md"],
      done_when: ["tests pass"],
      stop_conditions: ["missing skill"],
      output_schema_ref: "schemas/verification-record.schema.json",
      verification_required: true,
      rollback_hint: "remove generated artifact",
    };

    const executed = await executeTaskEnvelope({
      envelope,
      provider,
      repo,
      skill_loader: loader,
      required_skill_ids: ["typescript-implementer"],
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.inputs).toEqual([
      {
        kind: TaskInputKind.File,
        ref: "src/task.txt",
        content: "implement the runtime slice",
      },
      {
        kind: TaskInputKind.ExternalNote,
        ref: "note-1",
        content: null,
      },
    ]);
    expect(captured[0]?.skills.map((skill) => skill.contract.skill_id)).toEqual([
      "typescript-implementer",
    ]);
    expect(await repo.read("artifacts/run.txt")).toBe("runtime executed");
    expect(executed.result.summary).toBe("executed 2 inputs with 1 skills");
  });

  it("fails fast when a required skill is missing", async () => {
    const repo = new InMemoryRepoAdapter();
    const loader = new StaticSkillLoader([]);
    const envelope: TaskEnvelope = {
      objective: "Implement the adapter boundary",
      task_level: TaskLevel.L2,
      inputs: [],
      allowed_tools: ["rg"],
      write_scope: ["src"],
      must_not: [],
      done_when: ["tests pass"],
      stop_conditions: ["missing skill"],
      output_schema_ref: "schemas/verification-record.schema.json",
      verification_required: true,
      rollback_hint: "remove generated artifact",
    };

    await expect(
      executeTaskEnvelope({
        envelope,
        provider: {
          provider_id: "mock-provider",
          model_id: "mock-model",
          execute() {
            throw new Error("provider should not run when skill loading fails");
          },
        },
        repo,
        skill_loader: loader,
        required_skill_ids: ["missing-skill"],
      }),
    ).rejects.toThrow("missing required skills: missing-skill");
  });

  it("supports execution without required skills and validates repo snapshots", async () => {
    const repo = new InMemoryRepoAdapter({
      "src/task.txt": "read runtime slice",
    });

    const envelope: TaskEnvelope = {
      objective: "Read the adapter boundary",
      task_level: TaskLevel.L1,
      inputs: [
        {
          kind: TaskInputKind.File,
          ref: "src/task.txt",
        },
        {
          kind: TaskInputKind.StateSnapshot,
          ref: "snapshot-1",
        },
      ],
      allowed_tools: ["rg"],
      write_scope: ["src"],
      must_not: [],
      done_when: ["notes captured"],
      stop_conditions: [],
      output_schema_ref: "schemas/verification-record.schema.json",
      verification_required: false,
      rollback_hint: "none",
    };

    const materialized = await materializeTaskInputs(envelope, repo);
    expect(materialized).toEqual([
      {
        kind: TaskInputKind.File,
        ref: "src/task.txt",
        content: "read runtime slice",
      },
      {
        kind: TaskInputKind.StateSnapshot,
        ref: "snapshot-1",
        content: null,
      },
    ]);

    const executed = await executeTaskEnvelope({
      envelope,
      provider: {
        provider_id: "mock-provider",
        model_id: "mock-model",
        execute(request) {
          expect(request.skills).toEqual([]);

          return {
            provider_id: "mock-provider",
            model_id: "mock-model",
            summary: request.inputs.map((input) => input.ref).join(","),
          };
        },
      },
      repo,
      skill_loader: new StaticSkillLoader([]),
    });

    expect(executed.skills).toEqual([]);
    expect(executed.result.summary).toBe("src/task.txt,snapshot-1");
    expect(isSnapshotCapableRepoAdapter(repo)).toBe(true);
    expect(isSnapshotCapableRepoAdapter({
      read() {
        return "";
      },
      write() {},
    })).toBe(false);
    expect(() => repo.restoreSnapshot({ invalid: 1 })).toThrow(
      "repo snapshot must be a string record",
    );
  });

  it("defaults static skill sources when a registry entry omits them", async () => {
    const loader = new StaticSkillLoader([
      {
        contract: {
          skill_id: "source-default",
          purpose: "Default source test",
          preconditions: [],
          allowed_roles: ["engineer"],
          allowed_targets: ["src"],
          side_effect_level: SideEffectLevel.None,
          requires_lock: false,
          verification_required: false,
          failure_recovery: [],
        },
      },
    ]);

    expect(loader.load("source-default")).toEqual({
      contract: expect.objectContaining({
        skill_id: "source-default",
      }),
      source: "static",
    });
  });
});
