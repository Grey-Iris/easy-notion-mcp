const FIXTURE_NDJSON = [
  '{"type":"system","subtype":"init","tools":["mcp__easy-notion__get_me"],"model":"claude-sonnet-4-6"}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_abc","name":"mcp__easy-notion__get_me","input":{}}]}}',
  '{"type":"user","content":[{"type":"tool_result","tool_use_id":"toolu_abc","content":[{"type":"text","text":"{\\"id\\":\\"349be876\\",\\"name\\":\\"Test\\",\\"type\\":\\"bot\\"}"}]}]}',
  '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.028,"num_turns":1,"result":"The bot id is 349be876."}',
].join("\n");

async function importDispatch() {
  return import("./dispatch.ts");
}

describe("bench harness dispatch", () => {
  it("buildMcpConfig returns the expected MCP JSON shape", async () => {
    const { buildMcpConfig } = await importDispatch();

    expect(buildMcpConfig("http://127.0.0.1:3333/mcp", "secret-bearer")).toEqual({
      mcpServers: {
        "easy-notion": {
          type: "http",
          url: "http://127.0.0.1:3333/mcp",
          headers: {
            Authorization: "Bearer secret-bearer",
          },
        },
      },
    });
  });

  it("parseStreamJson extracts tool events and the final result", async () => {
    const { parseStreamJson } = await importDispatch();

    const parsed = parseStreamJson(FIXTURE_NDJSON);

    expect(parsed).toEqual(
      expect.objectContaining({
        toolUses: expect.any(Array),
        toolResults: expect.any(Array),
        result: expect.anything(),
        model: "claude-sonnet-4-6",
        events: expect.any(Array),
      }),
    );
    expect(parsed.toolUses[0].name).toBe("mcp__easy-notion__get_me");
    expect(parsed.toolResults[0].toolUseId).toBe("toolu_abc");
    expect(parsed.result?.text).toBe("The bot id is 349be876.");
    expect(parsed.result?.costUsd).toBe(0.028);
  });

  it("parseStreamJson tolerates unknown event types", async () => {
    const { parseStreamJson } = await importDispatch();

    const ndjson = [
      '{"type":"rate_limit_event","remaining":123}',
      '{"type":"system","subtype":"hook_start","hook":"pre_tool"}',
      FIXTURE_NDJSON,
      '{"type":"system","subtype":"hook_end","hook":"pre_tool"}',
    ].join("\n");

    const parsed = parseStreamJson(ndjson);

    expect(parsed.toolUses).toHaveLength(1);
    expect(parsed.toolResults).toHaveLength(1);
    expect(parsed.result?.text).toBe("The bot id is 349be876.");
  });

  it("parseStreamJson handles empty input", async () => {
    const { parseStreamJson } = await importDispatch();

    const parsed = parseStreamJson("");

    expect(parsed.toolUses).toEqual([]);
    expect(parsed.toolResults).toEqual([]);
    expect(parsed.result).toBeNull();
    expect(parsed.model).toBeNull();
    expect(parsed.events).toEqual([]);
  });
});
