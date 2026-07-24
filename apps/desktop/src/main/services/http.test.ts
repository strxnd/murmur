import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { fetchWithTimeout, readResponseText } from "./http";

const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()));
});

describe("HTTP response body timeouts", () => {
  it("honors a caller-provided abort signal while waiting for response headers", async () => {
    const { url } = await startServer(() => {
      // Keep the request open so cancellation has to come from the caller signal.
    });
    const controller = new AbortController();

    const request = fetchWithTimeout(url, { signal: controller.signal }, 500);
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("honors a caller-provided abort signal while reading a response body", async () => {
    const { url } = await startServer((response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"partial":');
    });
    const controller = new AbortController();
    const response = await fetchWithTimeout(url, { signal: controller.signal }, 500);

    const body = readResponseText(response, {
      totalTimeoutMs: 500,
      idleTimeoutMs: 500,
      label: "test",
      signal: controller.signal
    });
    controller.abort();

    await expect(body).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects when a response body stalls after headers", async () => {
    const { url } = await startServer((response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"partial":');
    });

    const response = await fetchWithTimeout(url, {}, 500);

    await expect(readResponseText(response, { totalTimeoutMs: 50, idleTimeoutMs: 20, label: "test" })).rejects.toThrow(
      /test response body/
    );
  });

  it("uses one deadline across response headers and body consumption", async () => {
    const { url } = await startServer((response) => {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.write("partial");
        setTimeout(() => response.end(" complete"), 80);
      }, 80);
    });

    const response = await fetchWithTimeout(url, {}, 120);

    await expect(readResponseText(response, { totalTimeoutMs: 120, idleTimeoutMs: 120, label: "test" })).rejects.toThrow(
      "Request timed out after 120ms."
    );
  });
});

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
