export interface HeartbeatAssessmentOptions {
  now?: Date;
  maxStalenessMs: number;
}

export function hasFreshHeartbeat(
  lastHeartbeatAt: string | null,
  options: HeartbeatAssessmentOptions,
): boolean {
  if (!lastHeartbeatAt) {
    return false;
  }

  const observedAt = Date.parse(lastHeartbeatAt);
  if (Number.isNaN(observedAt)) {
    return false;
  }

  const now = options.now ?? new Date();
  return now.getTime() - observedAt <= options.maxStalenessMs;
}
