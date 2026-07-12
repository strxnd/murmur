import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { LlmProviderConfig } from "../../shared/types";
import { LlmService } from "./llm";

const servers: Array<() => Promise<void>> = [];
const originalTotalTimeout = process.env.MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS;
const originalIdleTimeout = process.env.MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS;

afterEach(async () => {
  restoreTimeoutEnv();
  await Promise.all(servers.splice(0).map((close) => close()));
});

describe("LlmService", () => {
  it("returns a failed validation result when the provider connection fails", async () => {
    const { url } = await startServer((response) => response.socket?.destroy());
    const service = new LlmService();

    const result = await service.validate(ollamaProvider(url));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^Provider connection failed:/);
  });

  it("rejects stalled response bodies", async () => {
    process.env.MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS = "60";
    process.env.MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS = "20";
    const { url } = await startServer((response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"message":');
    });

    const service = new LlmService();

    await expect(service.process({ provider: ollamaProvider(url), prompt: "clean this up" })).rejects.toThrow(/Ollama response/);
  });
});

function ollamaProvider(baseUrl: string): LlmProviderConfig {
  return {
    id: "ollama",
    type: "ollama",
    name: "Ollama",
    baseUrl,
    isCloud: false,
    defaultModel: "llama3.1",
    enabled: true
  };
}

function restoreTimeoutEnv(): void {
  restoreEnvValue("MURMUR_PROVIDER_RESPONSE_TIMEOUT_MS", originalTotalTimeout);
  restoreEnvValue("MURMUR_PROVIDER_RESPONSE_IDLE_TIMEOUT_MS", originalIdleTimeout);
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function startServer(handler: (response: ServerResponse) => void): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();
    const server = createServer((_request, response) => handler(response));
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP port."));
        return;
      }
      servers.push(() => closeServer(server, sockets));
      resolve({ url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
