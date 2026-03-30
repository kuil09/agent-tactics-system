import { describe, expect, it } from "vitest";

import {
  AssignmentDecisionValue,
  MicrobenchStatus,
  ProviderKind,
  TaskLevel,
  Transport,
  TrustTier,
} from "../../src/contracts/enums.js";
import { evaluateAssignment } from "../../src/policies/assignment-gate.js";
import { getAssignmentModeForTaskLevel } from "../../src/policies/trust-tier.js";
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

  it("rejects provider and model mismatches before trust-tier evaluation", () => {
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

    expect(
      evaluateAssignment({
        task_id: "task-provider-mismatch",
        candidate_provider_id: "other-provider",
        candidate_model: "gpt-5.4",
        target_role: "implementer",
        requested_task_level: TaskLevel.L4,
        provider,
      }).reasons,
    ).toContain("candidate provider does not match registry entry");

    expect(
      evaluateAssignment({
        task_id: "task-model-mismatch",
        candidate_provider_id: "openai-prod",
        candidate_model: "gpt-5.4-mini",
        target_role: "implementer",
        requested_task_level: TaskLevel.L4,
        provider,
      }).reasons,
    ).toContain("candidate model is not registered for provider");
  });

  it("rejects unregistered, non-compliant, and unsupported assignment requests", () => {
    const unregisteredProvider = createProviderRegistryEntry({
      provider_id: "openai-prod",
      provider_kind: ProviderKind.OpenAI,
      transport: Transport.Api,
      models: [{ model_id: "gpt-5.4", task_levels_supported: [TaskLevel.L4] }],
      eligibility: {
        registered: false,
      },
    });

    expect(
      evaluateAssignment({
        task_id: "task-unregistered",
        candidate_provider_id: "openai-prod",
        candidate_model: "gpt-5.4",
        target_role: "implementer",
        requested_task_level: TaskLevel.L4,
        provider: unregisteredProvider,
      }).reasons,
    ).toContain("provider is not registered");

    const nonCompliantProvider = createProviderRegistryEntry({
      provider_id: "openai-prod",
      provider_kind: ProviderKind.OpenAI,
      transport: Transport.Api,
      models: [{ model_id: "gpt-5.4", task_levels_supported: [TaskLevel.L4] }],
      eligibility: {
        registered: true,
        protocol_compliant: false,
      },
    });

    expect(
      evaluateAssignment({
        task_id: "task-non-compliant",
        candidate_provider_id: "openai-prod",
        candidate_model: "gpt-5.4",
        target_role: "implementer",
        requested_task_level: TaskLevel.L4,
        provider: nonCompliantProvider,
      }).reasons,
    ).toContain("provider failed protocol compliance");

    const unsupportedLevelProvider = createProviderRegistryEntry({
      provider_id: "openai-prod",
      provider_kind: ProviderKind.OpenAI,
      transport: Transport.Api,
      models: [{ model_id: "gpt-5.4", task_levels_supported: [TaskLevel.L2] }],
      eligibility: {
        protocol_compliant: true,
        heartbeat_ok: true,
        microbench_status: MicrobenchStatus.Pass,
        last_calibrated_at: "2026-03-30T00:00:00Z",
      },
    });

    expect(
      evaluateAssignment({
        task_id: "task-unsupported-level",
        candidate_provider_id: "openai-prod",
        candidate_model: "gpt-5.4",
        target_role: "implementer",
        requested_task_level: TaskLevel.L4,
        provider: unsupportedLevelProvider,
      }).reasons,
    ).toContain("candidate model does not advertise support for requested task level");
  });

  it("returns the fallback reject reason when no assignment mode is available", () => {
    const provider = {
      ...createProviderRegistryEntry({
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
      }),
      assignment_modes: [],
    };

    const decision = evaluateAssignment({
      task_id: "task-no-modes",
      candidate_provider_id: "openai-prod",
      candidate_model: "gpt-5.4",
      target_role: "implementer",
      requested_task_level: TaskLevel.L4,
      provider,
    });

    expect(decision.decision).toBe(AssignmentDecisionValue.Reject);
    expect(decision.reasons).toContain(
      "provider evidence does not allow assignment or decomposition",
    );
  });

  it("decomposes when trust policy limits the provider to decomposition-only work", () => {
    const provider = createProviderRegistryEntry({
      provider_id: "cursor-local",
      provider_kind: ProviderKind.Cursor,
      transport: Transport.Cli,
      models: [{ model_id: "cursor-agent", task_levels_supported: [TaskLevel.L3] }],
      eligibility: {
        protocol_compliant: true,
        heartbeat_ok: true,
        microbench_status: MicrobenchStatus.Pass,
        last_calibrated_at: "2026-03-30T00:00:00Z",
      },
    });

    const decision = evaluateAssignment({
      task_id: "task-decompose-tier",
      candidate_provider_id: "cursor-local",
      candidate_model: "cursor-agent",
      target_role: "executor",
      requested_task_level: TaskLevel.L3,
      provider,
    });

    expect(decision.decision).toBe(AssignmentDecisionValue.Decompose);
    expect(decision.reasons).toContain(
      "trust tier T1 is limited to decompose_only for L3",
    );
  });

  it("maps trust tiers to assignment modes explicitly", () => {
    expect(getAssignmentModeForTaskLevel(TrustTier.T4, TaskLevel.L5)).toBe("direct");
    expect(getAssignmentModeForTaskLevel(TrustTier.T2, TaskLevel.L2)).toBe("decompose_only");
    expect(getAssignmentModeForTaskLevel(TrustTier.T0, TaskLevel.L1)).toBe("reject");
  });
});
