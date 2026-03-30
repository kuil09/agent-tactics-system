import { PatchOperation, VerificationStatus } from "../contracts/enums.js";
import type {
  CompletionVerificationInput,
  StateOperation,
  VerificationDecision,
} from "../contracts/types.js";

export class VerificationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationPolicyError";
  }
}

export interface CompletionPromotionPlan {
  verification_record: NonNullable<CompletionVerificationInput["verification_record"]>;
  verified_operations: StateOperation[];
  complete_operations: StateOperation[];
}

export function evaluateCompletionVerification(
  input: CompletionVerificationInput,
): VerificationDecision {
  const reasons: string[] = [];
  const record = input.verification_record;

  if (!record) {
    reasons.push("verification record is required before completion can be promoted");
  } else {
    if (record.subject_id !== input.subject_id) {
      reasons.push("verification record subject does not match the completion candidate");
    }

    if (record.status !== VerificationStatus.Pass) {
      reasons.push("verification record must be in pass status");
    }

    if (record.verifier_provider_id !== input.verifier.provider_id) {
      reasons.push("verification record provider does not match the selected verifier");
    }

    if (record.verifier_model !== input.verifier.model) {
      reasons.push("verification record model does not match the selected verifier");
    }
  }

  if (sameProviderFamily(input.executor_provider_kind, input.verifier.provider_kind)) {
    reasons.push("executor and verifier must come from different provider families");
  }

  return {
    approved: reasons.length === 0,
    reasons: reasons.length === 0 ? ["independent verification evidence is valid"] : reasons,
    verification_record: record,
  };
}

export function planCompletionPromotion(
  input: CompletionVerificationInput,
): CompletionPromotionPlan {
  const decision = evaluateCompletionVerification(input);

  if (!decision.approved || !decision.verification_record) {
    throw new VerificationPolicyError(decision.reasons.join("; "));
  }

  return {
    verification_record: decision.verification_record,
    verified_operations: [
      {
        op: PatchOperation.Replace,
        path: "/status",
        value: "verified",
      },
      {
        op: PatchOperation.Add,
        path: "/verification",
        value: {
          verification_id: decision.verification_record.verification_id,
          verifier_provider_id: decision.verification_record.verifier_provider_id,
          verifier_model: decision.verification_record.verifier_model,
          evidence: decision.verification_record.evidence,
          verified_at: decision.verification_record.created_at,
        },
      },
    ],
    complete_operations: [
      {
        op: PatchOperation.Replace,
        path: "/status",
        value: "complete",
      },
    ],
  };
}

export function sameProviderFamily(
  left: CompletionVerificationInput["executor_provider_kind"],
  right: CompletionVerificationInput["verifier"]["provider_kind"],
): boolean {
  return left === right;
}
