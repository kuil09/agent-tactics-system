import { describe, expect, it } from "vitest";

import {
  AssignmentDecisionValue,
  MicrobenchStatus,
  ProviderKind,
  TaskLevel,
  Transport,
} from "../../src/contracts/enums.js";
import { evaluateAssignment } from "../../src/policies/assignment-gate.js";
import { createProviderRegistryEntry } from "../../src/providers/registry.js";

describe("assignment gate", () => {
  it("decomposes when a registered provider lacks direct-assignment evidence", () => {
    const provider = createProviderRegistryEntry({
      provider_id: "openai-prod",
      provider_kind: ProviderKind.OpenAI,
      transport: Transport.Api,
      models: [{ model_id: "gpt-5.4", task_levels_supported: [TaskLevel.L4] }],
      eligibility: {
        protocol_compliant: true,
        heartbeat_ok: true,
        microbench_status: MicrobenchStatus.Pass,
      },
    });

    const decision = evaluateAssignment({
      task_id: "task-123",
      candidate_provider_id: "openai-prod",
      candidate_model: "gpt-5.4",
      target_role: "implementer",
      requested_task_level: TaskLevel.L4,
      provider,
    });

    expect(decision.decision).toBe(AssignmentDecisionValue.Decompose);
    expect(decision.independent_verifier_required).toBe(false);
  });

  it("rejects high-level work for weak trust tiers", () => {
    const provider = createProviderRegistryEntry({
      provider_id: "cursor-local",
      provider_kind: ProviderKind.Cursor,
      transport: Transport.Cli,
      trust_tier: undefined,
      models: [{ model_id: "cursor-agent", task_levels_supported: [TaskLevel.L5] }],
      eligibility: {
        protocol_compliant: true,
        heartbeat_ok: true,
        microbench_status: MicrobenchStatus.Pass,
        last_calibrated_at: "2026-03-30T00:00:00Z",
      },
    });

    const decision = evaluateAssignment({
      task_id: "task-456",
      candidate_provider_id: "cursor-local",
      candidate_model: "cursor-agent",
      target_role: "executor",
      requested_task_level: TaskLevel.L5,
      provider,
    });

    expect(decision.decision).toBe(AssignmentDecisionValue.Reject);
    expect(decision.reasons).toContain("trust tier T1 cannot take L5 work");
  });

  it("assigns when both trust-tier policy and evidence gates pass", () => {
    const provider = createProviderRegistryEntry({
      provider_id: "openai-prod",
      provider_kind: ProviderKind.OpenAI,
      transport: Transport.Api,
      models: [{ model_id: "gpt-5.4", task_levels_supported: [TaskLevel.L4] }],
      eligibility: {
        protocol_compliant: true,
        heartbeat_ok: true,
        microbench_status: MicrobenchStatus.Pass,
        last_calibrated_at: "2026-03-30T00:00:00Z",
      },
    });

    const decision = evaluateAssignment({
      task_id: "task-789",
      candidate_provider_id: "openai-prod",
      candidate_model: "gpt-5.4",
      target_role: "implementer",
      requested_task_level: TaskLevel.L4,
      required_skills: ["typescript"],
      provider,
    });

    expect(decision.decision).toBe(AssignmentDecisionValue.Assign);
    expect(decision.required_skills).toEqual(["typescript"]);
    expect(decision.independent_verifier_required).toBe(true);
  });
});
