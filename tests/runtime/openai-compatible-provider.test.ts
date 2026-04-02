import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderKind, TaskInputKind, TaskLevel } from "../../src/contracts/enums.js";
import { connectProviderApiAdapter, executeTaskEnvelope } from "../../src/adapters/provider-api/index.js";
import { InMemoryRepoAdapter } from "../../src/adapters/repo/index.js";
import { StaticSkillLoader } from "../../src/skills/loader.js";
import { createOpenAICompatibleProviderModule } from "../../src/runtime/openai-compatible-provider.js";
import { startRuntimeFixtureProviderServer } from "../../src/runtime/runtime-fixture-provider-server.js";

describe("openai-compatible runtime provider", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
  });

  it("performs an HTTP handshake before executing the runtime request", async () => {
    const server = await startRuntimeFixtureProviderServer();
    cleanup.push(() => server.close());

    const provider = await connectProviderApiAdapter({
      module: createOpenAICompatibleProviderModule({
        providerId: "openai-runtime",
        providerKind: ProviderKind.OpenAI,
        modelId: "gpt-5.4",
        baseUrl: server.baseUrl,
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
      provider_id: "openai-runtime",
      provider_kind: ProviderKind.OpenAI,
      model_id: "gpt-5.4",
      protocol_version: "provider-module-v1",
      metadata: {
        scenario: "success",
        transport: "http",
      },
    });
    expect(await repo.read("artifacts/runtime.log")).toBe(
      "Connect heartbeat records to the shared runtime entrypoint :: wire runtime",
    );
    expect(executed.result.summary).toBe(
      "executed runtime heartbeat turn via provider-module-v1",
    );
  });

  it("records partial writes before surfacing a provider-backed failure", async () => {
    const server = await startRuntimeFixtureProviderServer();
    cleanup.push(() => server.close());

    const provider = await connectProviderApiAdapter({
      module: createOpenAICompatibleProviderModule({
        providerId: "openai-runtime",
        providerKind: ProviderKind.OpenAI,
        modelId: "gpt-5.4",
        baseUrl: server.baseUrl,
      }),
      context: {
        scenario: "failure",
      },
    });
    const repo = new InMemoryRepoAdapter({
      "src/task.txt": "rollback runtime",
      "artifacts/seed-state.json": JSON.stringify(
        {
          scenario: "failure",
          baseline: true,
        },
        null,
        2,
      ),
    });

    await expect(
      executeTaskEnvelope({
        envelope: {
          objective: "Exercise shared runtime rollback and requeue",
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
          done_when: ["rollback evidence exists"],
          stop_conditions: [],
          output_schema_ref: "schemas/verification-record.schema.json",
          verification_required: false,
          rollback_hint: "restore snapshot",
        },
        provider,
        repo,
        skill_loader: new StaticSkillLoader([]),
      }),
    ).rejects.toThrow("simulated runtime failure after provider execution");

    expect(await repo.read("artifacts/runtime.log")).toBe(
      "Exercise shared runtime rollback and requeue :: rollback runtime",
    );
    expect(await repo.read("artifacts/partial-output.json")).toContain(
      "\"protocol\": \"provider-module-v1\"",
    );
    expect(await repo.read("artifacts/partial-output.json")).toContain(
      "\"mutated_paths\": [",
    );
    expect(await repo.read("artifacts/seed-state.json")).toContain(
      "\"status\": \"mutated-before-rollback\"",
    );
    expect(await repo.read("src/generated.ts")).toBe(
      "export const generatedDuringFailure = true;\n",
    );
    expect(await repo.read("src/task.txt")).toBe(
      "rollback runtime :: provider modified input before failing\n",
    );
  });

  it("adds API key headers, defaults unknown scenarios, and joins array completions", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "gpt-5.4" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    { type: "output_text", text: "runtime execution" },
                    { type: "ignored" },
                    { type: "output_text", text: " from array" },
                  ],
                },
              },
            ],
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
      module: createOpenAICompatibleProviderModule({
        providerId: "openai-runtime",
        providerKind: ProviderKind.OpenAI,
        modelId: "gpt-5.4",
        baseUrl: "https://provider.test",
        apiKey: "top-secret",
      }),
    });
    const repo = new InMemoryRepoAdapter();

    const executed = await executeTaskEnvelope({
      envelope: {
        objective: "Connect heartbeat records to the shared runtime entrypoint",
        task_level: TaskLevel.L1,
        inputs: [],
        allowed_tools: ["node"],
        write_scope: ["artifacts"],
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

    expect(provider.handshake.metadata).toMatchObject({
      scenario: "unknown",
      transport: "http",
      endpoint_origin: "https://provider.test",
    });
    expect(await repo.read("artifacts/runtime.log")).toBe("runtime execution from array");
    expect(executed.result.summary).toBe(
      "executed runtime heartbeat turn via provider-module-v1",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer top-secret",
        "Content-Type": "application/json",
      },
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer top-secret",
        "Content-Type": "application/json",
      },
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(JSON.parse(requestBody.messages[1]?.content ?? "{}")).toMatchObject({
      objective: "Connect heartbeat records to the shared runtime entrypoint",
      primary_input: "",
      protocol_version: "provider-module-v1",
    });
  });

  it("fails when the provider omits completion text", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "gpt-5.4" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [],
                },
              },
            ],
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
      module: createOpenAICompatibleProviderModule({
        providerId: "openai-runtime",
        providerKind: ProviderKind.OpenAI,
        modelId: "gpt-5.4",
        baseUrl: "https://provider.test",
      }),
      context: {
        scenario: "success",
      },
    });

    await expect(
      executeTaskEnvelope({
        envelope: {
          objective: "Exercise completion text validation",
          task_level: TaskLevel.L1,
          inputs: [],
          allowed_tools: ["node"],
          write_scope: ["artifacts"],
          must_not: [],
          done_when: ["runtime log exists"],
          stop_conditions: [],
          output_schema_ref: "schemas/verification-record.schema.json",
          verification_required: false,
          rollback_hint: "remove runtime log",
        },
        provider,
        repo: new InMemoryRepoAdapter(),
        skill_loader: new StaticSkillLoader([]),
      }),
    ).rejects.toThrow("provider response did not include completion text");
  });

  it("surfaces non-success provider responses during handshake", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      connectProviderApiAdapter({
        module: createOpenAICompatibleProviderModule({
          providerId: "openai-runtime",
          providerKind: ProviderKind.OpenAI,
          modelId: "gpt-5.4",
          baseUrl: "https://provider.test",
        }),
      }),
    ).rejects.toThrow("provider request failed with status 503");
  });
});
