import {
  AssignmentDecisionValue,
  AssignmentMode,
  TaskLevel,
} from "../contracts/enums.js";
import type { AssignmentDecision, ProviderRegistryEntry } from "../contracts/types.js";
import { getAssignmentModeForTaskLevel } from "./trust-tier.js";

export interface AssignmentGateInput {
  task_id: string;
  candidate_provider_id: string;
  candidate_model: string;
  target_role: string;
  requested_task_level: TaskLevel;
  required_skills?: string[];
  provider: ProviderRegistryEntry;
}

function toDecision(
  input: AssignmentGateInput,
  decision: AssignmentDecisionValue,
  reasons: string[],
): AssignmentDecision {
  return {
    task_id: input.task_id,
    candidate_provider_id: input.candidate_provider_id,
    candidate_model: input.candidate_model,
    target_role: input.target_role,
    requested_task_level: input.requested_task_level,
    decision,
    reasons,
    required_skills: input.required_skills ?? [],
    independent_verifier_required: decision === AssignmentDecisionValue.Assign,
  };
}

export function evaluateAssignment(input: AssignmentGateInput): AssignmentDecision {
  const reasons: string[] = [];

  if (input.provider.provider_id !== input.candidate_provider_id) {
    return toDecision(input, AssignmentDecisionValue.Reject, [
      "candidate provider does not match registry entry",
    ]);
  }

  if (!input.provider.eligibility.registered) {
    return toDecision(input, AssignmentDecisionValue.Reject, [
      "provider is not registered",
    ]);
  }

  if (!input.provider.eligibility.protocol_compliant) {
    return toDecision(input, AssignmentDecisionValue.Reject, [
      "provider failed protocol compliance",
    ]);
  }

  const model = input.provider.models.find(
    (candidate) => candidate.model_id === input.candidate_model,
  );

  if (!model) {
    return toDecision(input, AssignmentDecisionValue.Reject, [
      "candidate model is not registered for provider",
    ]);
  }

  if (!model.task_levels_supported.includes(input.requested_task_level)) {
    return toDecision(input, AssignmentDecisionValue.Reject, [
      "candidate model does not advertise support for requested task level",
    ]);
  }

  const tierMode = getAssignmentModeForTaskLevel(
    input.provider.trust_tier,
    input.requested_task_level,
  );
  const entryAllowsDirect = input.provider.assignment_modes.includes(AssignmentMode.Direct);
  const entryAllowsDecompose = input.provider.assignment_modes.includes(
    AssignmentMode.DecomposeOnly,
  );

  if (tierMode === AssignmentMode.Reject) {
    return toDecision(input, AssignmentDecisionValue.Reject, [
      `trust tier ${input.provider.trust_tier} cannot take ${input.requested_task_level} work`,
    ]);
  }

  if (tierMode === AssignmentMode.DecomposeOnly) {
    reasons.push(
      `trust tier ${input.provider.trust_tier} is limited to decompose_only for ${input.requested_task_level}`,
    );
    return toDecision(input, AssignmentDecisionValue.Decompose, reasons);
  }

  if (entryAllowsDirect) {
    reasons.push("provider evidence satisfies direct assignment gate");
    return toDecision(input, AssignmentDecisionValue.Assign, reasons);
  }

  if (entryAllowsDecompose) {
    reasons.push("provider is registered but lacks evidence for direct assignment");
    return toDecision(input, AssignmentDecisionValue.Decompose, reasons);
  }

  return toDecision(input, AssignmentDecisionValue.Reject, [
    "provider evidence does not allow assignment or decomposition",
  ]);
}
