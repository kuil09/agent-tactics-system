import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderKind, TaskInputKind, TaskLevel } from "../../src/contracts/enums.js";
import { connectProviderApiAdapter, executeTaskEnvelope } from "../../src/adapters/provider-api/index.js";
import { InMemoryRepoAdapter } from "../../src/adapters/repo/index.js";
import { StaticSkillLoader } from "../../src/skills/loader.js";
import { createClaudeProviderModule } from "../../src/runtime/claude-provider.js";

describe("claude runtime provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists models before executing a messages API request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "claude-sonnet-4-5" }],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "runtime execution" }],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = await connectProviderApiAdapter({
      module: createClaudeProviderModule({
        providerId: "claude-runtime",
        modelId: "claude-sonnet-4-5",
        baseUrl: "https://claude.test",
        apiKey: "claude-secret",
      }),
      context: {
        scenario: "success",
      },
    });
    const repo = new InMemoryRepoAdapter({
      "src/task.txt": "wire runtime",
    });

    const executed = await executeTaskEnvelope({
      envelope: {
        objective: "Connect heartbeat records to the shared runtime entrypoint",
        task_level: TaskLevel.L3,
        inputs: [
          {
            kind: TaskInputKind.File,
            ref: "src/task.txt",
          },
        ],
        allowed_tools: ["node"],
        write_scope: ["src", "artifacts"],
        must_not: [],
        done_when: ["runtime log exists"],
        stop_conditions: [],
        output_schema_ref: "schemas/verification-record.schema.json",
        verification_required: false,
        rollback_hint: "remove runtime log",
      },
      provider,
      repo,
      skill_loader: new StaticSkillLoader([]),
    });

    expect(provider.handshake).toMatchObject({
      provider_id: "claude-runtime",
      provider_kind: ProviderKind.Claude,
      model_id: "claude-sonnet-4-5",
      protocol_version: "provider-module-v1",
      metadata: {
        scenario: "success",
        transport: "http",
        endpoint_origin: "https://claude.test",
      },
    });
    expect(await repo.read("artifacts/runtime.log")).toBe("runtime execution");
    expect(executed.result.summary).toBe(
      "executed runtime heartbeat turn via provider-module-v1",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://claude.test/v1/models");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": "claude-secret",
      },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://claude.test/v1/messages");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      model: string;
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody).toMatchObject({
      model: "claude-sonnet-4-5",
      system: "You are a runtime fixture provider. Return the execution log line only.",
    });
    expect(JSON.parse(requestBody.messages[0]?.content ?? "{}")).toMatchObject({
      objective: "Connect heartbeat records to the shared runtime entrypoint",
      primary_input: "wire runtime",
      protocol_version: "provider-module-v1",
    });
  });

  it("fails the handshake when the requested model is unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-opus-4-1" }],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      connectProviderApiAdapter({
        module: createClaudeProviderModule({
          providerId: "claude-runtime",
          modelId: "claude-sonnet-4-5",
          baseUrl: "https://claude.test",
        }),
      }),
    ).rejects.toThrow("claude provider does not expose model 'claude-sonnet-4-5'");
  });
});
