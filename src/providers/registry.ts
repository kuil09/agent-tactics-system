import {
  AssignmentMode,
  MicrobenchStatus,
  ProviderKind,
  Transport,
  TrustTier,
} from "../contracts/enums.js";
import type {
  ProviderEligibility,
  ProviderModelCapability,
  ProviderRegistryEntry,
} from "../contracts/types.js";
import { hasPassingMicrobench } from "./microbench.js";

export interface ProviderRegistrationInput {
  provider_id: string;
  provider_kind: ProviderKind;
  transport: Transport;
  models: ProviderModelCapability[];
  eligibility?: Partial<ProviderEligibility>;
  trust_tier?: TrustTier;
}

const DEFAULT_ELIGIBILITY: ProviderEligibility = {
  registered: true,
  protocol_compliant: false,
  heartbeat_ok: false,
  microbench_status: MicrobenchStatus.Unknown,
  last_calibrated_at: null,
};

export function inferTrustTier(providerKind: ProviderKind): TrustTier {
  switch (providerKind) {
    case ProviderKind.OpenAI:
    case ProviderKind.Claude:
      return TrustTier.T3;
    case ProviderKind.OpenCode:
    case ProviderKind.Cursor:
      return TrustTier.T1;
    case ProviderKind.LocalOpenAICompatible:
    case ProviderKind.Other:
    default:
      return TrustTier.T0;
  }
}

export function deriveAssignmentModes(
  trustTier: TrustTier,
  eligibility: ProviderEligibility,
): AssignmentMode[] {
  if (!eligibility.registered || !eligibility.protocol_compliant) {
    return [AssignmentMode.Reject];
  }

  if (!eligibility.heartbeat_ok || eligibility.microbench_status === MicrobenchStatus.Fail) {
    return [AssignmentMode.Reject];
  }

  if (
    !hasPassingMicrobench(eligibility.microbench_status) ||
    eligibility.last_calibrated_at === null
  ) {
    return [AssignmentMode.DecomposeOnly];
  }

  switch (trustTier) {
    case TrustTier.T4:
    case TrustTier.T3:
      return [AssignmentMode.Direct, AssignmentMode.DecomposeOnly];
    case TrustTier.T2:
    case TrustTier.T1:
      return [AssignmentMode.DecomposeOnly];
    case TrustTier.T0:
    default:
      return [AssignmentMode.Reject];
  }
}

export function createProviderRegistryEntry(
  input: ProviderRegistrationInput,
): ProviderRegistryEntry {
  const trustTier = input.trust_tier ?? inferTrustTier(input.provider_kind);
  const eligibility: ProviderEligibility = {
    ...DEFAULT_ELIGIBILITY,
    ...input.eligibility,
  };

  return {
    provider_id: input.provider_id,
    provider_kind: input.provider_kind,
    transport: input.transport,
    models: input.models,
    trust_tier: trustTier,
    eligibility,
    assignment_modes: deriveAssignmentModes(trustTier, eligibility),
  };
}
