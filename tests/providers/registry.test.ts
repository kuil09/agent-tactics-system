import { describe, expect, it } from "vitest";

import {
  AssignmentMode,
  MicrobenchStatus,
  ProviderKind,
  TaskLevel,
  Transport,
  TrustTier,
} from "../../src/contracts/enums.js";
import { createProviderRegistryEntry, deriveAssignmentModes } from "../../src/providers/registry.js";

describe("provider registry", () => {
  it("does not unlock direct assignment from registration alone", () => {
    const entry = createProviderRegistryEntry({
      provider_id: "openai-prod",
      provider_kind: ProviderKind.OpenAI,
      transport: Transport.Api,
      models: [{ model_id: "gpt-5.4", task_levels_supported: [TaskLevel.L3] }],
      eligibility: {
        protocol_compliant: true,
      },
    });

    expect(entry.trust_tier).toBe(TrustTier.T3);
    expect(entry.assignment_modes).toEqual([AssignmentMode.Reject]);
  });

  it("downgrades high-tier providers to decompose_only until calibration exists", () => {
    const modes = deriveAssignmentModes(TrustTier.T3, {
      registered: true,
      protocol_compliant: true,
      heartbeat_ok: true,
      microbench_status: MicrobenchStatus.Pass,
      last_calibrated_at: null,
    });

    expect(modes).toEqual([AssignmentMode.DecomposeOnly]);
  });

  it("allows direct assignment only after evidence is complete", () => {
    const entry = createProviderRegistryEntry({
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

    expect(entry.assignment_modes).toEqual([
      AssignmentMode.Direct,
      AssignmentMode.DecomposeOnly,
    ]);
  });
});
