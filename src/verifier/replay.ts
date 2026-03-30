import type { VerificationRecord } from "../contracts/types.js";

export interface VerificationReplaySummary {
  subject_id: string;
  verification_ids: string[];
  evidence: string[];
}

export function buildVerificationReplay(
  subjectId: string,
  records: VerificationRecord[],
): VerificationReplaySummary {
  const matchingRecords = records.filter((record) => record.subject_id === subjectId);

  return {
    subject_id: subjectId,
    verification_ids: matchingRecords.map((record) => record.verification_id),
    evidence: matchingRecords.flatMap((record) => record.evidence),
  };
}
