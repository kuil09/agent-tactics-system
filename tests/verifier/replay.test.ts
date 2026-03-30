import { describe, expect, it } from "vitest";

import {
  VerificationStatus,
  VerificationSubjectKind,
} from "../../src/contracts/enums.js";
import { buildVerificationReplay } from "../../src/verifier/replay.js";

describe("buildVerificationReplay", () => {
  it("builds sorted replay evidence and recovery paths from verification history", () => {
    const replay = buildVerificationReplay("issue-1", [
      {
        verification_id: "verify-2",
        subject_id: "issue-1",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "claude-verify",
        verifier_model: "claude-sonnet-4",
        status: VerificationStatus.Requeue,
        evidence: ["requeue after rollback"],
        created_at: "2026-03-30T12:01:00Z",
      },
      {
        verification_id: "verify-1",
        subject_id: "issue-1",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "claude-verify",
        verifier_model: "claude-sonnet-4",
        status: VerificationStatus.Fail,
        evidence: ["capture failing artifact", "requeue after rollback"],
        created_at: "2026-03-30T12:00:00Z",
      },
      {
        verification_id: "verify-other",
        subject_id: "issue-2",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "claude-verify",
        verifier_model: "claude-sonnet-4",
        status: VerificationStatus.Pass,
        evidence: ["ignore other issue"],
        created_at: "2026-03-30T11:59:00Z",
      },
    ]);

    expect(replay).toEqual({
      subject_id: "issue-1",
      verification_ids: ["verify-1", "verify-2"],
      evidence: ["capture failing artifact", "requeue after rollback"],
      latest_status: VerificationStatus.Requeue,
      latest_created_at: "2026-03-30T12:01:00Z",
      status_counts: {
        pending: 0,
        pass: 0,
        fail: 1,
        requeue: 1,
      },
      recovery_paths: ["rollback", "requeue"],
      timeline: [
        {
          verification_id: "verify-1",
          status: VerificationStatus.Fail,
          evidence: ["capture failing artifact", "requeue after rollback"],
          created_at: "2026-03-30T12:00:00Z",
        },
        {
          verification_id: "verify-2",
          status: VerificationStatus.Requeue,
          evidence: ["requeue after rollback"],
          created_at: "2026-03-30T12:01:00Z",
        },
      ],
    });
  });

  it("returns empty replay metadata when no verification records match", () => {
    const replay = buildVerificationReplay("issue-missing", [
      {
        verification_id: "verify-pending",
        subject_id: "issue-other",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "claude-verify",
        verifier_model: "claude-sonnet-4",
        status: VerificationStatus.Pending,
        evidence: ["waiting on verifier"],
        created_at: "2026-03-30T12:02:00Z",
      },
      {
        verification_id: "verify-pass",
        subject_id: "issue-other",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "claude-verify",
        verifier_model: "claude-sonnet-4",
        status: VerificationStatus.Pass,
        evidence: ["approved"],
        created_at: "2026-03-30T12:03:00Z",
      },
    ]);

    expect(replay).toEqual({
      subject_id: "issue-missing",
      verification_ids: [],
      evidence: [],
      latest_status: null,
      latest_created_at: null,
      status_counts: {
        pending: 0,
        pass: 0,
        fail: 0,
        requeue: 0,
      },
      recovery_paths: [],
      timeline: [],
    });
  });

  it("tracks pending verification records and ignores unknown statuses", () => {
    const replay = buildVerificationReplay("issue-1", [
      {
        verification_id: "verify-pending",
        subject_id: "issue-1",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "claude-verify",
        verifier_model: "claude-sonnet-4",
        status: VerificationStatus.Pending,
        evidence: ["awaiting verifier"],
        created_at: "2026-03-30T12:04:00Z",
      },
      {
        verification_id: "verify-unknown",
        subject_id: "issue-1",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "claude-verify",
        verifier_model: "claude-sonnet-4",
        status: "unknown" as VerificationStatus,
        evidence: ["unexpected"],
        created_at: "2026-03-30T12:05:00Z",
      },
    ]);

    expect(replay.recovery_paths).toContain("await_verifier");
    expect(replay.status_counts.pending).toBe(1);
    expect(replay.latest_status).toBe("unknown");
  });
});
