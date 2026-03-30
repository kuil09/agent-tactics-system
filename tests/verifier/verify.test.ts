import { describe, expect, it } from "vitest";

import {
  ProviderKind,
  VerificationStatus,
  VerificationSubjectKind,
} from "../../src/contracts/enums.js";
import {
  evaluateCompletionVerification,
  planCompletionPromotion,
  VerificationPolicyError,
} from "../../src/verifier/verify.js";

describe("completion verification", () => {
  it("rejects promotion when the verification record is missing", () => {
    const decision = evaluateCompletionVerification({
      subject_id: "issue-1",
      executor_provider_id: "openai-prod",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      verifier: {
        provider_id: "claude-prod",
        provider_kind: ProviderKind.Claude,
        model: "claude-sonnet-4",
      },
      verification_record: null,
    });

    expect(decision.approved).toBe(false);
    expect(decision.reasons).toContain(
      "verification record is required before completion can be promoted",
    );
  });

  it("rejects promotion when executor and verifier share the same provider family", () => {
    const decision = evaluateCompletionVerification({
      subject_id: "issue-1",
      executor_provider_id: "openai-prod",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      verifier: {
        provider_id: "openai-verify",
        provider_kind: ProviderKind.OpenAI,
        model: "gpt-5.4-mini",
      },
      verification_record: {
        verification_id: "verify-1",
        subject_id: "issue-1",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "openai-verify",
        verifier_model: "gpt-5.4-mini",
        status: VerificationStatus.Pass,
        evidence: ["npm test"],
        created_at: "2026-03-30T00:00:00Z",
      },
    });

    expect(decision.approved).toBe(false);
    expect(decision.reasons).toContain(
      "executor and verifier must come from different provider families",
    );
  });

  it("builds verified and complete transitions after independent verification passes", () => {
    const plan = planCompletionPromotion({
      subject_id: "issue-1",
      executor_provider_id: "openai-prod",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      verifier: {
        provider_id: "claude-prod",
        provider_kind: ProviderKind.Claude,
        model: "claude-sonnet-4",
      },
      verification_record: {
        verification_id: "verify-1",
        subject_id: "issue-1",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "claude-prod",
        verifier_model: "claude-sonnet-4",
        status: VerificationStatus.Pass,
        evidence: ["npm test", "npm run typecheck"],
        created_at: "2026-03-30T00:00:00Z",
      },
    });

    expect(plan.verified_operations).toEqual([
      {
        op: "replace",
        path: "/status",
        value: "verified",
      },
      {
        op: "add",
        path: "/verification",
        value: {
          verification_id: "verify-1",
          verifier_provider_id: "claude-prod",
          verifier_model: "claude-sonnet-4",
          evidence: ["npm test", "npm run typecheck"],
          verified_at: "2026-03-30T00:00:00Z",
        },
      },
    ]);
    expect(plan.complete_operations).toEqual([
      {
        op: "replace",
        path: "/status",
        value: "complete",
      },
    ]);
  });

  it("throws when promotion is attempted without a valid verifier record", () => {
    expect(() =>
      planCompletionPromotion({
        subject_id: "issue-1",
        executor_provider_id: "openai-prod",
        executor_provider_kind: ProviderKind.OpenAI,
        executor_model: "gpt-5.4",
        verifier: {
          provider_id: "claude-prod",
          provider_kind: ProviderKind.Claude,
          model: "claude-sonnet-4",
        },
        verification_record: {
          verification_id: "verify-1",
          subject_id: "issue-2",
          subject_kind: VerificationSubjectKind.Task,
          verifier_provider_id: "claude-prod",
          verifier_model: "claude-sonnet-4",
          status: VerificationStatus.Fail,
          evidence: ["failed"],
          created_at: "2026-03-30T00:00:00Z",
        },
      }),
    ).toThrow(VerificationPolicyError);
  });

  it("rejects verification records that do not match the selected verifier identity", () => {
    const decision = evaluateCompletionVerification({
      subject_id: "issue-1",
      executor_provider_id: "openai-prod",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      verifier: {
        provider_id: "claude-prod",
        provider_kind: ProviderKind.Claude,
        model: "claude-sonnet-4",
      },
      verification_record: {
        verification_id: "verify-2",
        subject_id: "issue-1",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "other-verifier",
        verifier_model: "other-model",
        status: VerificationStatus.Pass,
        evidence: ["npm test"],
        created_at: "2026-03-30T00:00:00Z",
      },
    });

    expect(decision.approved).toBe(false);
    expect(decision.reasons).toContain(
      "verification record provider does not match the selected verifier",
    );
    expect(decision.reasons).toContain(
      "verification record model does not match the selected verifier",
    );
  });
});
