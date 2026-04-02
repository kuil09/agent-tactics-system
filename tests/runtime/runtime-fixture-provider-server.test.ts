import { describe, expect, it } from "vitest";

import { startRuntimeFixtureProviderServer } from "../../src/runtime/runtime-fixture-provider-server.js";

describe("runtime fixture provider server", () => {
  it("serves handshake metadata for the fixture model", async () => {
    const server = await startRuntimeFixtureProviderServer();

    try {
      const response = await fetch(`${server.baseUrl}/v1/models/gpt-5.4`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: "gpt-5.4",
        object: "model",
        owned_by: "runtime-fixture-provider",
      });
    } finally {
      await server.close();
    }
  });

  it("returns fallback log text when the runtime prompt omits optional fields", async () => {
    const server = await startRuntimeFixtureProviderServer();

    try {
      const response = await fetch(`${server.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: JSON.stringify({}),
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        choices: [
          {
            message: {
              content: "unknown objective :: ",
            },
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("reports malformed requests and unknown routes with explicit status codes", async () => {
    const server = await startRuntimeFixtureProviderServer();

    try {
      const missingUserMessage = await fetch(`${server.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "system only",
            },
          ],
        }),
      });
      expect(missingUserMessage.status).toBe(400);
      await expect(missingUserMessage.json()).resolves.toMatchObject({
        error: "missing user message",
      });

      const malformedJson = await fetch(`${server.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{",
      });
      expect(malformedJson.status).toBe(500);
      await expect(malformedJson.json()).resolves.toMatchObject({
        error: expect.stringContaining("JSON"),
      });

      const notFound = await fetch(`${server.baseUrl}/v1/unknown`);
      expect(notFound.status).toBe(404);
      await expect(notFound.json()).resolves.toMatchObject({
        error: "not found",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects duplicate shutdown requests after the server is already closed", async () => {
    const server = await startRuntimeFixtureProviderServer();

    await server.close();

    await expect(server.close()).rejects.toThrow(/server is not running/i);
  });
});
