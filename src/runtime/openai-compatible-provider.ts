import { ProviderKind } from "../contracts/enums.js";
import type {
  ProviderApiModule,
  ProviderHandshakeContext,
  ProviderModuleExecutionRequest,
} from "../adapters/provider-api/index.js";

export interface OpenAICompatibleProviderConfig {
  providerId: string;
  providerKind: ProviderKind;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
}

interface ModelLookupResponse {
  id: string;
  object?: string;
  owned_by?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export function createOpenAICompatibleProviderModule(
  config: OpenAICompatibleProviderConfig,
): ProviderApiModule {
  return {
    async handshake(context) {
      const response = await fetchJson<ModelLookupResponse>(
        `${config.baseUrl}/v1/models/${config.modelId}`,
        {
          method: "GET",
          headers: buildHeaders(config.apiKey),
        },
      );

      return {
        provider_id: config.providerId,
        provider_kind: config.providerKind,
        model_id: config.modelId,
        protocol_version: "provider-module-v1",
        summary: `openai-compatible handshake established for ${response.id}`,
        metadata: buildHandshakeMetadata(context, config.baseUrl),
      };
    },
    async execute(request) {
      const completion = await fetchJson<ChatCompletionResponse>(
        `${config.baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: buildHeaders(config.apiKey),
          body: JSON.stringify({
            model: config.modelId,
            messages: [
              {
                role: "system",
                content:
                  "You are a runtime fixture provider. Return the execution log line only.",
              },
              {
                role: "user",
                content: buildExecutionPrompt(request),
              },
            ],
          }),
        },
      );

      const executionLog = extractCompletionText(completion);

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
    },
  };
}

function buildHandshakeMetadata(
  context: ProviderHandshakeContext,
  baseUrl: string,
): Record<string, string> {
  return {
    scenario: context.scenario ?? "unknown",
    transport: "http",
    endpoint_origin: baseUrl,
  };
}

function buildExecutionPrompt(request: ProviderModuleExecutionRequest): string {
  const primaryInput = request.inputs[0]?.content ?? "";
  return JSON.stringify({
    objective: request.envelope.objective,
    primary_input: primaryInput,
    protocol_version: request.handshake.protocol_version,
  });
}

function extractCompletionText(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  throw new Error("provider response did not include completion text");
}

function buildHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

async function fetchJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(`provider request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}
