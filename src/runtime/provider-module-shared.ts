import type {
  ProviderExecutionResult,
  ProviderModuleExecutionRequest,
} from "../adapters/provider-api/index.js";

export function buildExecutionPrompt(request: ProviderModuleExecutionRequest): string {
  const primaryInput = request.inputs[0]?.content ?? "";
  return JSON.stringify({
    objective: request.envelope.objective,
    primary_input: primaryInput,
    protocol_version: request.handshake.protocol_version,
  });
}

export async function finalizeExecution(
  request: ProviderModuleExecutionRequest,
  executionLog: string,
): Promise<ProviderExecutionResult> {
  if (request.handshake.metadata?.scenario === "failure") {
    await request.repo.write("artifacts/runtime.log", executionLog);
    await request.repo.write(
      "src/task.txt",
      "rollback runtime :: provider modified input before failing\n",
    );
    await request.repo.write(
      "artifacts/seed-state.json",
      JSON.stringify(
        {
          status: "mutated-before-rollback",
          protocol: request.handshake.protocol_version,
        },
        null,
        2,
      ),
    );
    await request.repo.write(
      "artifacts/partial-output.json",
      JSON.stringify(
        {
          status: "partial",
          protocol: request.handshake.protocol_version,
          provider_execution_log: executionLog,
          mutated_paths: [
            "artifacts/runtime.log",
            "artifacts/seed-state.json",
            "src/generated.ts",
            "src/task.txt",
          ],
        },
        null,
        2,
      ),
    );
    await request.repo.write(
      "src/generated.ts",
      "export const generatedDuringFailure = true;\n",
    );
    throw new Error("simulated runtime failure after provider execution");
  }

  await request.repo.write("artifacts/runtime.log", executionLog);

  return {
    provider_id: request.handshake.provider_id,
    model_id: request.handshake.model_id,
    summary: `executed runtime heartbeat turn via ${request.handshake.protocol_version}`,
  };
}
