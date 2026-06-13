import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { callTool } from "./mcp-client.js";

describe("callTool", () => {
  it("calls a stdio MCP tool and returns text content plus isError", async () => {
    const fakeServer = `
let buffer = "";
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
process.stderr.write("mock stderr\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\\n")) {
    const newlineIndex = buffer.indexOf("\\n");
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "0.0.1" } } });
    }
    if (message.method === "tools/call") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            { type: "text", text: JSON.stringify({ name: message.params.name, arguments: message.params.arguments }) },
            { type: "image", data: "ignored" },
          ],
          isError: message.params.arguments.isError === true,
        },
      });
    }
  }
});
`;

    const result = await callTool(
      {
        command: process.execPath,
        args: ["-e", fakeServer],
        cwd: path.dirname(fileURLToPath(import.meta.url)),
      },
      "echo",
      { value: 42, isError: true },
      { timeoutMs: 5_000 },
    );

    expect(result.contentTexts).toEqual([
      JSON.stringify({ name: "echo", arguments: { value: 42, isError: true } }),
    ]);
    expect(result.isError).toBe(true);
    expect(result.rawResult).toEqual({
      content: [
        { type: "text", text: JSON.stringify({ name: "echo", arguments: { value: 42, isError: true } }) },
        { type: "image", data: "ignored" },
      ],
      isError: true,
    });
    expect(result.stderr).toContain("mock stderr");
  });
});
