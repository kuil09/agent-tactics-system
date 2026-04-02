import { readFile } from "node:fs/promises";

import {
  parseRuntimeFixtureCliOptions,
  runRuntimeFixtureCli,
  type RuntimeFixtureOperatorSummary,
} from "./cli.js";

async function main(): Promise<void> {
  const options = parseRuntimeFixtureCliOptions(process.argv.slice(2), process.env);
  const result = await runRuntimeFixtureCli(options);
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
        provider_handshake_path: result.providerHandshakePath,
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
