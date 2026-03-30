import { AssignmentMode, TaskLevel, TrustTier } from "../contracts/enums.js";

const DIRECT_LEVELS_BY_TIER: Record<TrustTier, TaskLevel[]> = {
  [TrustTier.T0]: [],
  [TrustTier.T1]: [],
  [TrustTier.T2]: [],
  [TrustTier.T3]: [TaskLevel.L1, TaskLevel.L2, TaskLevel.L3, TaskLevel.L4, TaskLevel.L5],
  [TrustTier.T4]: [TaskLevel.L1, TaskLevel.L2, TaskLevel.L3, TaskLevel.L4, TaskLevel.L5],
};

const DECOMPOSE_LEVELS_BY_TIER: Record<TrustTier, TaskLevel[]> = {
  [TrustTier.T0]: [],
  [TrustTier.T1]: [TaskLevel.L1, TaskLevel.L2, TaskLevel.L3],
  [TrustTier.T2]: [TaskLevel.L1, TaskLevel.L2, TaskLevel.L3],
  [TrustTier.T3]: [TaskLevel.L1, TaskLevel.L2, TaskLevel.L3, TaskLevel.L4, TaskLevel.L5],
  [TrustTier.T4]: [TaskLevel.L1, TaskLevel.L2, TaskLevel.L3, TaskLevel.L4, TaskLevel.L5],
};

export function getAssignmentModeForTaskLevel(
  trustTier: TrustTier,
  taskLevel: TaskLevel,
): AssignmentMode {
  if (DIRECT_LEVELS_BY_TIER[trustTier].includes(taskLevel)) {
    return AssignmentMode.Direct;
  }

  if (DECOMPOSE_LEVELS_BY_TIER[trustTier].includes(taskLevel)) {
    return AssignmentMode.DecomposeOnly;
  }

  return AssignmentMode.Reject;
}
