import { VerificationStatus } from "../contracts/enums.js";
import type { VerificationRecord } from "../contracts/types.js";

export interface VerificationReplayEvent {
  verification_id: string;
  status: VerificationStatus;
  evidence: string[];
  created_at: string;
}

export interface VerificationReplaySummary {
  subject_id: string;
  verification_ids: string[];
  evidence: string[];
  latest_status: VerificationStatus | null;
  latest_created_at: string | null;
  status_counts: Record<VerificationStatus, number>;
  recovery_paths: string[];
  timeline: VerificationReplayEvent[];
}

export function buildVerificationReplay(
  subjectId: string,
  records: VerificationRecord[],
): VerificationReplaySummary {
  const matchingRecords = records
    .filter((record) => record.subject_id === subjectId)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const latestRecord = matchingRecords.at(-1) ?? null;

  return {
    subject_id: subjectId,
    verification_ids: matchingRecords.map((record) => record.verification_id),
    evidence: dedupeStrings(matchingRecords.flatMap((record) => record.evidence)),
    latest_status: latestRecord?.status ?? null,
    latest_created_at: latestRecord?.created_at ?? null,
    status_counts: countStatuses(matchingRecords),
    recovery_paths: dedupeStrings(
      matchingRecords.flatMap((record) => recoveryPathsForStatus(record.status)),
    ),
    timeline: matchingRecords.map((record) => ({
      verification_id: record.verification_id,
      status: record.status,
      evidence: [...record.evidence],
      created_at: record.created_at,
    })),
  };
}

function countStatuses(
  records: VerificationRecord[],
): Record<VerificationStatus, number> {
  const counts: Record<VerificationStatus, number> = {
    [VerificationStatus.Pending]: 0,
    [VerificationStatus.Pass]: 0,
    [VerificationStatus.Fail]: 0,
    [VerificationStatus.Requeue]: 0,
  };

  for (const record of records) {
    counts[record.status] += 1;
  }

  return counts;
}

function recoveryPathsForStatus(status: VerificationStatus): string[] {
  switch (status) {
    case VerificationStatus.Fail:
      return ["rollback", "requeue"];
    case VerificationStatus.Requeue:
      return ["requeue"];
    case VerificationStatus.Pending:
      return ["await_verifier"];
    case VerificationStatus.Pass:
      return [];
    default:
      return [];
  }
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
