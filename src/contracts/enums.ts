export enum TaskLevel {
  L1 = "L1",
  L2 = "L2",
  L3 = "L3",
  L4 = "L4",
  L5 = "L5",
}

export enum AssignmentDecisionValue {
  Assign = "assign",
  Decompose = "decompose",
  Reject = "reject",
}

export enum ProviderKind {
  OpenAI = "openai",
  Claude = "claude",
  OpenCode = "opencode",
  Cursor = "cursor",
  LocalOpenAICompatible = "local_openai_compatible",
  Other = "other",
}

export enum Transport {
  Api = "api",
  Cli = "cli",
  Embedded = "embedded",
  Other = "other",
}

export enum TrustTier {
  T0 = "T0",
  T1 = "T1",
  T2 = "T2",
  T3 = "T3",
  T4 = "T4",
}

export enum MicrobenchStatus {
  Unknown = "unknown",
  Pass = "pass",
  Fail = "fail",
}

export enum AssignmentMode {
  Direct = "direct",
  DecomposeOnly = "decompose_only",
  Reject = "reject",
}

export enum TaskInputKind {
  Issue = "issue",
  File = "file",
  StateSnapshot = "state_snapshot",
  ExternalNote = "external_note",
  Other = "other",
}

export enum SideEffectLevel {
  None = "none",
  ReadOnly = "read_only",
  WriteLocal = "write_local",
  WriteExternal = "write_external",
  Transactional = "transactional",
}

export enum PatchOperation {
  Add = "add",
  Replace = "replace",
  Remove = "remove",
}

export enum VerificationSubjectKind {
  Task = "task",
  StatePatch = "state_patch",
  Artifact = "artifact",
}

export enum VerificationStatus {
  Pending = "pending",
  Pass = "pass",
  Fail = "fail",
  Requeue = "requeue",
}

export enum HeartbeatOutcome {
  Noop = "noop",
  Delegated = "delegated",
  Patched = "patched",
  Blocked = "blocked",
  Verified = "verified",
}
