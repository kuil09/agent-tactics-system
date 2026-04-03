import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";

import {
  runRuntimeFixtureCli,
  type RuntimeFixtureCliResult,
  type RuntimeFixtureOperatorSummary,
  type RuntimeFixtureProviderTarget,
  type RuntimeFixtureScenario,
} from "../runtime/cli.js";
import type {
  ApprovalWorkflowHandoff,
  VerificationHandoff,
} from "../runtime/executable-runtime.js";

import type { IssueWorkbenchVerificationEvidence } from "./issue-workbench.js";

export interface RuntimeFixtureRunSummary {
  scenario: RuntimeFixtureScenario;
  outcome: RuntimeFixtureCliResult["outcome"];
  artifact_dir: string;
  workspace_dir: string;
  summary_path: string;
  runtime_log_path: string;
  provider_handshake_path: string;
  operator_summary: RuntimeFixtureOperatorSummary;
  verification_evidence: IssueWorkbenchVerificationEvidence;
  verification_handoff: VerificationHandoff;
  approval_workflow: ApprovalWorkflowHandoff;
  recovery: VerificationHandoff["recovery"];
  completed: unknown;
  recovered: unknown;
}

interface RuntimeFixtureSummaryFile {
  scenario: RuntimeFixtureScenario;
  outcome: RuntimeFixtureCliResult["outcome"];
  artifact_dir: string;
  workspace_dir: string;
  runtime_log_path: string;
  provider_handshake?: unknown;
  completed: unknown;
  verification_handoff: VerificationHandoff;
  verification_evidence: IssueWorkbenchVerificationEvidence;
  operator_summary: RuntimeFixtureOperatorSummary;
  recovered: unknown;
}

export interface RunRuntimeFixtureInput {
  scenario?: RuntimeFixtureScenario;
  providerTarget?: RuntimeFixtureProviderTarget;
}

export interface RuntimeFixtureService {
  runFixture(input?: RunRuntimeFixtureInput): Promise<RuntimeFixtureRunSummary>;
  getLatestRun(scenario?: RuntimeFixtureScenario): Promise<RuntimeFixtureRunSummary | null>;
}

export function createRuntimeFixtureService(input?: {
  rootDir?: string;
}): RuntimeFixtureService {
  const rootDir = resolve(input?.rootDir ?? process.cwd());

  return {
    async runFixture(request = {}): Promise<RuntimeFixtureRunSummary> {
      const scenario = request.scenario ?? "success";
      const result = await runRuntimeFixtureCli({
        scenario,
        rootDir,
        providerTarget: request.providerTarget,
      });
      return readSummary(result.summaryPath, result.providerHandshakePath);
    },

    async getLatestRun(scenario: RuntimeFixtureScenario = "success") {
      const summaryPath = join(rootDir, "artifacts", "runtime-fixtures", scenario, "run-result.json");
      try {
        await access(summaryPath, fsConstants.R_OK);
      } catch {
        return null;
      }

      return readSummary(summaryPath, `${summaryPath}#provider_handshake`);
    },
  };
}

async function readSummary(
  summaryPath: string,
  providerHandshakePath: string,
): Promise<RuntimeFixtureRunSummary> {
  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as RuntimeFixtureSummaryFile;

  return {
    scenario: summary.scenario,
    outcome: summary.outcome,
    artifact_dir: summary.artifact_dir,
    workspace_dir: summary.workspace_dir,
    summary_path: summaryPath,
    runtime_log_path: summary.runtime_log_path,
    provider_handshake_path: providerHandshakePath,
    operator_summary: summary.operator_summary,
    verification_evidence: summary.verification_evidence,
    verification_handoff: summary.verification_handoff,
    approval_workflow: summary.verification_handoff.approval_workflow,
    recovery: summary.verification_handoff.recovery,
    completed: summary.completed,
    recovered: summary.recovered,
  };
}
