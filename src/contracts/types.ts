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
} from "./enums.js";

export interface ProviderModelCapability {
  model_id: string;
  task_levels_supported: TaskLevel[];
}

export interface ProviderEligibility {
  registered: boolean;
  protocol_compliant: boolean;
  heartbeat_ok: boolean;
  microbench_status: MicrobenchStatus;
  last_calibrated_at: string | null;
}

export interface ProviderRegistryEntry {
  provider_id: string;
  provider_kind: ProviderKind;
  transport: Transport;
  models: ProviderModelCapability[];
  trust_tier: TrustTier;
  eligibility: ProviderEligibility;
  assignment_modes: AssignmentMode[];
}

export interface AssignmentDecision {
  task_id: string;
  candidate_provider_id: string;
  candidate_model: string;
  target_role: string;
  requested_task_level: TaskLevel;
  decision: AssignmentDecisionValue;
  reasons: string[];
  required_skills: string[];
  independent_verifier_required: boolean;
}

export interface TaskEnvelopeInput {
  kind: TaskInputKind;
  ref: string;
}

export interface TaskEnvelope {
  objective: string;
  task_level: TaskLevel;
  inputs: TaskEnvelopeInput[];
  allowed_tools: string[];
  write_scope: string[];
  must_not: string[];
  done_when: string[];
  stop_conditions: string[];
  output_schema_ref: string;
  verification_required: boolean;
  rollback_hint: string;
}

export interface SkillContract {
  skill_id: string;
  purpose: string;
  preconditions: string[];
  allowed_roles: string[];
  allowed_targets: string[];
  side_effect_level: SideEffectLevel;
  requires_lock: boolean;
  verification_required: boolean;
  failure_recovery: string[];
}

export type BrowserAuthMode = "none" | "session" | "sso" | "human_gate";

export type BrowserAction =
  | "open_page"
  | "click"
  | "fill_form"
  | "assert_dom"
  | "extract_text"
  | "screenshot"
  | "submit_transaction";

export interface BrowserSkillContract extends SkillContract {
  url_allowlist: string[];
  auth_mode: BrowserAuthMode;
  allowed_actions: BrowserAction[];
  denied_actions: BrowserAction[];
  evidence_requirement: string;
  budget_cap: {
    max_steps: number;
    max_screenshots: number;
  };
  escalate_on: string[];
}

export interface BrowserAccessRequest {
  role: string;
  target_url: string;
  action: BrowserAction;
  via_tool: string;
  skill: BrowserSkillContract | null;
}

export interface BrowserPolicyDecision {
  allowed: boolean;
  reasons: string[];
  matched_skill_id: string | null;
}

export interface StateOperation {
  op: PatchOperation;
  path: string;
  value: unknown;
}

export interface StatePatch {
  patch_id: string;
  issue_id: string;
  actor_id: string;
  base_state_version: number;
  operations: StateOperation[];
  requires_lock: boolean;
  verifier_required: boolean;
  rollback_to_version: number | null;
}

export interface VerificationRecord {
  verification_id: string;
  subject_id: string;
  subject_kind: VerificationSubjectKind;
  verifier_provider_id: string;
  verifier_model: string;
  status: VerificationStatus;
  evidence: string[];
  created_at: string;
}

export interface VerifierIdentity {
  provider_id: string;
  provider_kind: ProviderKind;
  model: string;
}

export interface CompletionVerificationInput {
  subject_id: string;
  executor_provider_id: string;
  executor_provider_kind: ProviderKind;
  executor_model: string;
  verifier: VerifierIdentity;
  verification_record: VerificationRecord | null;
}

export interface VerificationDecision {
  approved: boolean;
  reasons: string[];
  verification_record: VerificationRecord | null;
}

export interface HeartbeatActionBudget {
  tool_calls: number;
  write_ops: number;
}

export interface HeartbeatRecord {
  record_id: string;
  agent_id: string;
  issue_id: string;
  turn_number: number;
  inputs_summary: string;
  allowed_action_budget: HeartbeatActionBudget;
  started_at: string;
  finished_at: string | null;
  outcome: HeartbeatOutcome;
}
