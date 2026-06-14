async function importTokenCounter() {
  return import(new URL("../../scripts/bench/lib/token-counter.ts", import.meta.url).href);
}

describe("token counter", () => {
  it("counts cl100k tokens deterministically for a fixed string", async () => {
    const { countCl100k } = await importTokenCounter();

    expect(countCl100k("Tool surface benchmark: compact JSON beats noisy envelopes.")).toBe(10);
  });

  it("minifies the tools array for the canonical surface counted unit", async () => {
    const { minifyToolsForSurface } = await importTokenCounter();

    const compact = minifyToolsForSurface([
      {
        name: "read_page",
        description: "ReadPage",
        inputSchema: { type: "object", properties: { page_id: { type: "string" } } },
      },
    ]);

    expect(compact).toBe(
      '[{"name":"read_page","description":"ReadPage","inputSchema":{"type":"object","properties":{"page_id":{"type":"string"}}}}]',
    );
    expect(compact).not.toMatch(/\s/);
  });

  it("defers Anthropic counting without an API key", async () => {
    const { countAnthropic } = await importTokenCounter();
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      await expect(countAnthropic("same wrapper every time")).resolves.toEqual({
        available: false,
        reason: "no ANTHROPIC_API_KEY",
      });
    } finally {
      if (originalKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });
});
