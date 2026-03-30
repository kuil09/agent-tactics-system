import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const distDir = ".tmp-runtime-dist";

try {
  run("tsc", [
    "--outDir",
    distDir,
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    "--esModuleInterop",
    "--skipLibCheck",
    "--types",
    "node",
    "src/runtime/cli.ts",
  ]);

  run("node", [`${distDir}/runtime/cli.js`, ...process.argv.slice(2)]);
} finally {
  await rm(distDir, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
