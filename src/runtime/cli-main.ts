import { readFile } from "node:fs/promises";

import {
  parseScenario,
  runRuntimeFixtureCli,
  type RuntimeFixtureOperatorSummary,
} from "./cli.js";

async function main(): Promise<void> {
  const scenario = parseScenario(process.argv.slice(2));
  const result = await runRuntimeFixtureCli({ scenario });
  const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
    operator_summary: RuntimeFixtureOperatorSummary;
  };

  process.stdout.write(
    `${JSON.stringify(
      {
        scenario: result.scenario,
        outcome: result.outcome,
        artifact_dir: result.artifactDir,
        workspace_dir: result.workspaceDir,
        summary_path: result.summaryPath,
        runtime_log_path: result.runtimeLogPath,
        operator_summary: summary.operator_summary,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
