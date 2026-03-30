import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  HeartbeatOutcome,
  ProviderKind,
  SideEffectLevel,
  TaskInputKind,
  TaskLevel,
  VerificationStatus,
  VerificationSubjectKind,
} from "../contracts/enums.js";
import type {
  HeartbeatRecord,
  TaskEnvelope,
  VerificationRecord,
} from "../contracts/types.js";
import { FileSystemRepoAdapter } from "../adapters/repo/index.js";
import { StaticSkillLoader } from "../skills/loader.js";
import { runExecutableRuntime } from "./executable-runtime.js";

export type RuntimeFixtureScenario = "success" | "failure";

export interface RuntimeFixtureCliOptions {
  scenario: RuntimeFixtureScenario;
  rootDir?: string;
}

export interface RuntimeFixtureCliResult {
  scenario: RuntimeFixtureScenario;
  outcome: "patched" | "blocked";
  artifactDir: string;
  workspaceDir: string;
  summaryPath: string;
  runtimeLogPath: string;
}

export async function runRuntimeFixtureCli(
  options: RuntimeFixtureCliOptions,
): Promise<RuntimeFixtureCliResult> {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const artifactDir = join(rootDir, "artifacts", "runtime-fixtures", options.scenario);
  const workspaceDir = join(artifactDir, "workspace");
  const summaryPath = join(artifactDir, "run-result.json");
  const runtimeLogPath = join(workspaceDir, "artifacts", "runtime.log");

  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });

  const repo = new FileSystemRepoAdapter(workspaceDir);
  await seedWorkspace(repo, options.scenario);

  const fixture = createRuntimeFixture(options.scenario);
  const result = await runExecutableRuntime({
    heartbeat: fixture.heartbeat,
    envelope: fixture.envelope,
    provider: fixture.provider,
    repo,
    skill_loader: fixture.skillLoader,
    required_skill_ids: fixture.requiredSkillIds,
    verification_records: fixture.verificationRecords,
  });

  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        scenario: options.scenario,
        outcome:
          result.heartbeat.outcome === HeartbeatOutcome.Patched ? "patched" : "blocked",
        artifact_dir: artifactDir,
        workspace_dir: workspaceDir,
        runtime_log_path: runtimeLogPath,
        heartbeat: result.heartbeat,
        completed: result.completed,
        verification_handoff: result.verification_handoff,
        recovered: result.recovered ?? null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    scenario: options.scenario,
    outcome: result.heartbeat.outcome === HeartbeatOutcome.Patched ? "patched" : "blocked",
    artifactDir,
    workspaceDir,
    summaryPath,
    runtimeLogPath,
  };
}

interface RuntimeFixtureDefinition {
  heartbeat: HeartbeatRecord;
  envelope: TaskEnvelope;
  provider: {
    provider_id: string;
    provider_kind: ProviderKind;
    model_id: string;
    execute: Parameters<typeof runExecutableRuntime>[0]["provider"]["execute"];
  };
  skillLoader: StaticSkillLoader;
  requiredSkillIds: string[];
  verificationRecords: VerificationRecord[];
}

function createRuntimeFixture(
  scenario: RuntimeFixtureScenario,
): RuntimeFixtureDefinition {
  const skillLoader = new StaticSkillLoader([
    {
      contract: {
        skill_id: "runtime-writer",
        purpose: "Write runtime changes",
        preconditions: ["workspace is available"],
        allowed_roles: ["engineer"],
        allowed_targets: ["src", "artifacts", "tests"],
        side_effect_level: SideEffectLevel.WriteLocal,
        requires_lock: false,
        verification_required: true,
        failure_recovery: ["rerun runtime fixture"],
      },
      source: "runtime-cli-fixture",
    },
  ]);

  const heartbeat: HeartbeatRecord = {
    record_id: `hb-cli-${scenario}`,
    agent_id: "runtime-cli",
    issue_id: `runtime-cli-${scenario}`,
    turn_number: scenario === "success" ? 1 : 2,
    inputs_summary:
      scenario === "success"
        ? "Replay the shared runtime success path"
        : "Replay the shared runtime rollback path",
    allowed_action_budget: {
      tool_calls: 8,
      write_ops: 3,
    },
    started_at: "2026-03-31T00:00:00Z",
    finished_at: "2026-03-31T00:02:00Z",
    outcome: HeartbeatOutcome.Noop,
  };

  const envelope: TaskEnvelope = {
    objective:
      scenario === "success"
        ? "Connect heartbeat records to the shared runtime entrypoint"
        : "Exercise shared runtime rollback and requeue",
    task_level: TaskLevel.L3,
    inputs: [
      {
        kind: TaskInputKind.File,
        ref: "src/task.txt",
      },
    ],
    allowed_tools: ["node", "vitest"],
    write_scope: ["src", "tests", "artifacts"],
    must_not: ["modify docs/architecture.md"],
    done_when:
      scenario === "success"
        ? ["runtime fixture completes and emits artifacts"]
        : ["runtime fixture requeues after rollback"],
    stop_conditions: ["missing skill"],
    output_schema_ref: "schemas/verification-record.schema.json",
    verification_required: true,
    rollback_hint: "remove artifacts/runtime.log",
  };

  const verificationRecords: VerificationRecord[] =
    scenario === "success"
      ? [
          {
            verification_id: "verify-success",
            subject_id: "runtime-cli-success",
            subject_kind: VerificationSubjectKind.Task,
            verifier_provider_id: "claude-verify",
            verifier_model: "claude-sonnet-4",
            status: VerificationStatus.Pass,
            evidence: ["previous replay evidence"],
            created_at: "2026-03-30T23:50:00Z",
          },
        ]
      : [
          {
            verification_id: "verify-fail",
            subject_id: "runtime-cli-failure",
            subject_kind: VerificationSubjectKind.Task,
            verifier_provider_id: "claude-verify",
            verifier_model: "claude-sonnet-4",
            status: VerificationStatus.Fail,
            evidence: ["verification rejected execution"],
            created_at: "2026-03-30T23:50:00Z",
          },
          {
            verification_id: "verify-requeue",
            subject_id: "runtime-cli-failure",
            subject_kind: VerificationSubjectKind.Task,
            verifier_provider_id: "claude-verify",
            verifier_model: "claude-sonnet-4",
            status: VerificationStatus.Requeue,
            evidence: ["requeue after rollback"],
            created_at: "2026-03-30T23:51:00Z",
          },
        ];

  return {
    heartbeat,
    envelope,
    provider: {
      provider_id: "openai-runtime",
      provider_kind: ProviderKind.OpenAI,
      model_id: "gpt-5.4",
      async execute(request) {
        if (scenario === "failure") {
          await request.repo.write("artifacts/runtime.log", "transient execution");
          throw new Error("simulated runtime failure");
        }

        await request.repo.write(
          "artifacts/runtime.log",
          `${request.envelope.objective} :: ${request.inputs[0]!.content}`,
        );

        return {
          provider_id: "openai-runtime",
          model_id: "gpt-5.4",
          summary: "executed runtime heartbeat turn",
        };
      },
    },
    skillLoader,
    requiredSkillIds: ["runtime-writer"],
    verificationRecords,
  };
}

async function seedWorkspace(
  repo: FileSystemRepoAdapter,
  scenario: RuntimeFixtureScenario,
): Promise<void> {
  await repo.write(
    "src/task.txt",
    scenario === "success" ? "wire runtime" : "rollback runtime",
  );
}

/* c8 ignore start */
async function main(): Promise<void> {
  const scenario = parseScenario(process.argv.slice(2));
  const result = await runRuntimeFixtureCli({ scenario });

  process.stdout.write(
    `${JSON.stringify(
      {
        scenario: result.scenario,
        outcome: result.outcome,
        artifact_dir: result.artifactDir,
        workspace_dir: result.workspaceDir,
        summary_path: result.summaryPath,
        runtime_log_path: result.runtimeLogPath,
      },
      null,
      2,
    )}\n`,
  );
}
/* c8 ignore end */

export function parseScenario(args: string[]): RuntimeFixtureScenario {
  const scenarioFlag = args.find((arg) => arg.startsWith("--scenario="));

  if (scenarioFlag) {
    return coerceScenario(scenarioFlag.slice("--scenario=".length));
  }

  const scenarioIndex = args.indexOf("--scenario");
  if (scenarioIndex >= 0) {
    return coerceScenario(args[scenarioIndex + 1]);
  }

  return "success";
}

export function coerceScenario(value: string | undefined): RuntimeFixtureScenario {
  if (value === "success" || value === "failure") {
    return value;
  }

  throw new Error("scenario must be one of: success, failure");
}
/* c8 ignore start */
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;

if (invokedPath === resolve(import.meta.filename)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
/* c8 ignore end */
