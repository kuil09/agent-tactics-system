import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface RuntimeFixtureProviderServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startRuntimeFixtureProviderServer(): Promise<RuntimeFixtureProviderServer> {
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response);
    } catch (error) {
      /* c8 ignore next 1 */
      const message = error instanceof Error ? error.message : String(error);
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  /* c8 ignore next 3 */
  if (!address || typeof address === "string") {
    throw new Error("runtime fixture provider server did not expose a TCP address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/v1/models/gpt-5.4") {
    sendJson(response, 200, {
      id: "gpt-5.4",
      object: "model",
      owned_by: "runtime-fixture-provider",
    });
    return;
  }

  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    const payload = JSON.parse(await readBody(request)) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const userMessage = payload.messages?.find((message) => message.role === "user")?.content;

    if (!userMessage) {
      sendJson(response, 400, { error: "missing user message" });
      return;
    }

    const parsed = JSON.parse(userMessage) as {
      objective?: string;
      primary_input?: string;
    };
    const logLine = `${parsed.objective ?? "unknown objective"} :: ${parsed.primary_input ?? ""}`;

    sendJson(response, 200, {
      id: "chatcmpl-runtime-fixture",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: logLine,
          },
        },
      ],
    });
    return;
  }

  sendJson(response, 404, { error: "not found" });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}
