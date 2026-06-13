import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { queryDatabaseFull } from "./db-adapters.js";

describe("DB adapters", () => {
  it("resolves makenotion data source id and paginates query results", async () => {
    const result = await queryDatabaseFull("makenotion", mockLaunch(), "database-1", { timeoutMs: 5_000 });

    expect(result.callCount).toBe(3);
    expect(result.asConsumedText.split("\n").map((line) => JSON.parse(line))).toEqual([
      { id: "database-1", data_sources: [{ id: "data-source-1" }] },
      { results: [{ id: "row-1", properties: {} }], has_more: true, next_cursor: "cursor-2" },
      { results: [{ id: "row-2", properties: {} }], has_more: false },
    ]);
    expect(result.rows).toEqual({
      database: { id: "database-1", data_sources: [{ id: "data-source-1" }] },
      results: [
        { id: "row-1", properties: {} },
        { id: "row-2", properties: {} },
      ],
    });
    expect(result.raw).toEqual({
      database: { content: [{ type: "text", text: JSON.stringify({ id: "database-1", data_sources: [{ id: "data-source-1" }] }) }] },
      queries: [
        { results: [{ id: "row-1", properties: {} }], has_more: true, next_cursor: "cursor-2" },
        { results: [{ id: "row-2", properties: {} }], has_more: false },
      ],
    });
  });
});

function mockLaunch() {
  const fakeServer = `
let buffer = "";
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
function textResult(id, value) {
  send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }] } });
}
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
    if (message.method !== "tools/call") continue;
    const params = message.params;
    if (params.name === "API-retrieve-a-database") {
      textResult(message.id, { id: "database-1", data_sources: [{ id: "data-source-1" }] });
    }
    if (params.name === "API-query-data-source") {
      const args = params.arguments;
      if (args.data_source_id !== "data-source-1") {
        textResult(message.id, { error: "wrong data source" });
      }
      if (!args.start_cursor) {
        textResult(message.id, { results: [{ id: "row-1", properties: {} }], has_more: true, next_cursor: "cursor-2" });
      }
      if (args.start_cursor === "cursor-2") {
        textResult(message.id, { results: [{ id: "row-2", properties: {} }], has_more: false });
      }
    }
  }
});
`;
  return {
    command: process.execPath,
    args: ["-e", fakeServer],
    cwd: path.dirname(fileURLToPath(import.meta.url)),
  };
}
