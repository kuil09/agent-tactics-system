import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";

import {
  AssignmentDecisionValue,
  AssignmentMode,
  HeartbeatOutcome,
  MicrobenchStatus,
  PatchOperation,
  ProviderKind,
  SideEffectLevel,
  TaskInputKind,
  TaskLevel,
  Transport,
  TrustTier,
  VerificationStatus,
  VerificationSubjectKind,
} from "../../src/contracts/enums.js";
import type {
  AssignmentDecision,
  HeartbeatRecord,
  ProviderRegistryEntry,
  SkillContract,
  StatePatch,
  TaskEnvelope,
  VerificationRecord,
} from "../../src/contracts/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

type ValidatorFn = ((data: unknown) => boolean) & {
  errors?: ErrorObject[] | null;
};

type AjvInstance = {
  compile: (schema: Record<string, unknown>) => ValidatorFn;
};

type AjvCtor = new (options?: { allErrors?: boolean }) => AjvInstance;
type AddFormats = (ajv: AjvInstance) => AjvInstance;

const Ajv2020 = require("ajv/dist/2020").default as AjvCtor;
const addFormats = require("ajv-formats").default as AddFormats;

type SchemaFixture = {
  name: string;
  filename: string;
  sample:
    | ProviderRegistryEntry
    | AssignmentDecision
    | TaskEnvelope
    | SkillContract
    | StatePatch
    | VerificationRecord
    | HeartbeatRecord;
};

const fixtures: SchemaFixture[] = [
  {
    name: "ProviderRegistryEntry",
    filename: "provider-registry-entry.schema.json",
    sample: {
      provider_id: "openai-prod",
      provider_kind: ProviderKind.OpenAI,
      transport: Transport.Api,
      models: [
        {
          model_id: "gpt-5.4",
          task_levels_supported: [TaskLevel.L2, TaskLevel.L3, TaskLevel.L4],
        },
      ],
      trust_tier: TrustTier.T3,
      eligibility: {
        registered: true,
        protocol_compliant: true,
        heartbeat_ok: true,
        microbench_status: MicrobenchStatus.Pass,
        last_calibrated_at: "2026-03-30T00:00:00Z",
      },
      assignment_modes: [AssignmentMode.Direct],
    },
  },
  {
    name: "AssignmentDecision",
    filename: "assignment-decision.schema.json",
    sample: {
      task_id: "task-123",
      candidate_provider_id: "openai-prod",
      candidate_model: "gpt-5.4",
      target_role: "implementer",
      requested_task_level: TaskLevel.L3,
      decision: AssignmentDecisionValue.Assign,
      reasons: ["provider meets trust tier requirements"],
      required_skills: ["typescript", "vitest"],
      independent_verifier_required: true,
    },
  },
  {
    name: "TaskEnvelope",
    filename: "task-envelope.schema.json",
    sample: {
      objective: "Implement schema-aligned contract tests",
      task_level: TaskLevel.L3,
      inputs: [
        {
          kind: TaskInputKind.File,
          ref: "schemas/task-envelope.schema.json",
        },
      ],
      allowed_tools: ["rg", "npm", "vitest"],
      write_scope: ["src/contracts", "tests/contracts"],
      must_not: ["modify docs/architecture.md"],
      done_when: ["tests pass", "types compile"],
      stop_conditions: ["schema ambiguity", "missing workspace dependency"],
      output_schema_ref: "schemas/verification-record.schema.json",
      verification_required: true,
      rollback_hint: "revert generated contract baseline",
    },
  },
  {
    name: "SkillContract",
    filename: "skill-contract.schema.json",
    sample: {
      skill_id: "browser-test-local",
      purpose: "Verify local UI flows",
      preconditions: ["local server is running"],
      allowed_roles: ["qa", "engineer"],
      allowed_targets: ["localhost", "127.0.0.1"],
      side_effect_level: SideEffectLevel.ReadOnly,
      requires_lock: false,
      verification_required: true,
      failure_recovery: ["capture screenshot", "attach DOM evidence"],
    },
  },
  {
    name: "StatePatch",
    filename: "state-patch.schema.json",
    sample: {
      patch_id: "patch-123",
      issue_id: "issue-456",
      actor_id: "agent-789",
      base_state_version: 4,
      operations: [
        {
          op: PatchOperation.Replace,
          path: "/status",
          value: "in_review",
        },
      ],
      requires_lock: true,
      verifier_required: true,
      rollback_to_version: 3,
    },
  },
  {
    name: "VerificationRecord",
    filename: "verification-record.schema.json",
    sample: {
      verification_id: "verify-123",
      subject_id: "task-123",
      subject_kind: VerificationSubjectKind.Task,
      verifier_provider_id: "openai-prod",
      verifier_model: "gpt-5.4",
      status: VerificationStatus.Pass,
      evidence: ["npm test", "npm run typecheck"],
      created_at: "2026-03-30T00:00:00Z",
    },
  },
  {
    name: "HeartbeatRecord",
    filename: "heartbeat-record.schema.json",
    sample: {
      record_id: "hb-123",
      agent_id: "agent-789",
      issue_id: "issue-456",
      turn_number: 1,
      inputs_summary: "Resumed from issue status change",
      allowed_action_budget: {
        tool_calls: 12,
        write_ops: 4,
      },
      started_at: "2026-03-30T00:00:00Z",
      finished_at: "2026-03-30T00:02:00Z",
      outcome: HeartbeatOutcome.Patched,
    },
  },
];

function loadSchema(filename: string): Record<string, unknown> {
  const schemaPath = path.join(repoRoot, "schemas", filename);
  return JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
}

function createAjv() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  return ajv;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "unknown validation error";
  }

  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
    .join("; ");
}

function omitFirstRequired(
  schema: Record<string, unknown>,
  sample: SchemaFixture["sample"],
): Record<string, unknown> {
  const required = schema.required;
  if (!Array.isArray(required) || required.length === 0) {
    throw new Error("Schema fixture must define at least one required property");
  }

  const clone = structuredClone(sample) as unknown as Record<string, unknown>;
  delete clone[String(required[0])];
  return clone;
}

describe("contract schemas", () => {
  for (const fixture of fixtures) {
    it(`accepts a valid ${fixture.name} sample`, () => {
      const schema = loadSchema(fixture.filename);
      const ajv = createAjv();
      const validate = ajv.compile(schema);
      const valid = validate(fixture.sample);

      expect(valid, formatErrors(validate.errors)).toBe(true);
    });

    it(`rejects ${fixture.name} when a required field is missing`, () => {
      const schema = loadSchema(fixture.filename);
      const ajv = createAjv();
      const validate = ajv.compile(schema);
      const invalidSample = omitFirstRequired(schema, fixture.sample);
      const valid = validate(invalidSample);

      expect(valid).toBe(false);
    });
  }
});
