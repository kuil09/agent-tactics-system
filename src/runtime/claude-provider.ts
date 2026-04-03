import { ProviderKind } from "../contracts/enums.js";
import type { ProviderApiModule, ProviderHandshakeContext } from "../adapters/provider-api/index.js";
import { buildExecutionPrompt, finalizeExecution } from "./provider-module-shared.js";

const ANTHROPIC_VERSION = "2023-06-01";

export interface ClaudeProviderConfig {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
}

interface ClaudeModelsListResponse {
  data?: Array<{
    id?: string;
  }>;
}

interface ClaudeMessageResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

export function createClaudeProviderModule(
  config: ClaudeProviderConfig,
): ProviderApiModule {
  return {
    async handshake(context) {
      const response = await fetchJson<ClaudeModelsListResponse>(
        `${config.baseUrl}/v1/models`,
        {
          method: "GET",
          headers: buildHeaders(config.apiKey),
        },
      );
      const matchedModel = response.data?.find((model) => model.id === config.modelId);

      if (!matchedModel?.id) {
        throw new Error(`claude provider does not expose model '${config.modelId}'`);
      }

      return {
        provider_id: config.providerId,
        provider_kind: ProviderKind.Claude,
        model_id: config.modelId,
        protocol_version: "provider-module-v1",
        summary: `claude handshake established for ${matchedModel.id}`,
        metadata: buildHandshakeMetadata(context, config.baseUrl),
      };
    },
    async execute(request) {
      const response = await fetchJson<ClaudeMessageResponse>(
        `${config.baseUrl}/v1/messages`,
        {
          method: "POST",
          headers: buildHeaders(config.apiKey),
          body: JSON.stringify({
            model: config.modelId,
            max_tokens: 128,
            system: "You are a runtime fixture provider. Return the execution log line only.",
            messages: [
              {
                role: "user",
                content: buildExecutionPrompt(request),
              },
            ],
          }),
        },
      );

      return finalizeExecution(request, extractCompletionText(response));
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

function extractCompletionText(response: ClaudeMessageResponse): string {
  const text = response.content
    ?.filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("");

  if (text && text.length > 0) {
    return text;
  }

  throw new Error("provider response did not include completion text");
}

function buildHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
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
