async function importIr() {
  return import(new URL("../../scripts/bench/lib/ir.ts", import.meta.url).href);
}

describe("canonical token benchmark IR", () => {
  it("serializes deterministically and compactly", async () => {
    const { serializeIr } = await importIr();
    const ir = {
      blocks: [
        {
          text: "Hello",
          kind: "paragraph",
          annotations: { bold: true },
        },
      ],
      kind: "page",
      title: "Demo",
    };

    expect(serializeIr(ir)).toBe(
      '{"blocks":[{"annotations":{"bold":true},"kind":"paragraph","text":"Hello"}],"kind":"page","title":"Demo"}',
    );
    expect(serializeIr(ir)).not.toMatch(/\s/);
  });
});
