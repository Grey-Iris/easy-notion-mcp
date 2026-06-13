import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

async function importCorpusGenerator() {
  return import(new URL("../../scripts/bench/corpus/generate.ts", import.meta.url).href);
}

async function readFixtureTree(root: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();

  async function visit(dir: string): Promise<void> {
    const children = await readdir(dir, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      const fullPath = join(dir, child.name);
      if (child.isDirectory()) {
        await visit(fullPath);
      } else {
        entries.set(relative(root, fullPath), await readFile(fullPath, "utf8"));
      }
    }
  }

  await visit(root);
  return entries;
}

describe("token benchmark corpus generator", () => {
  it("generates byte-identical fixtures on repeated runs", async () => {
    const { generateCorpus } = await importCorpusGenerator();
    const root = await mkdtemp(join(tmpdir(), "bench-corpus-"));
    const first = join(root, "first");
    const second = join(root, "second");

    try {
      await generateCorpus(first);
      await generateCorpus(second);

      expect(await readFixtureTree(second)).toEqual(await readFixtureTree(first));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("generates the preregistered page and database classes", async () => {
    const { generateCorpus } = await importCorpusGenerator();
    const root = await mkdtemp(join(tmpdir(), "bench-corpus-"));

    try {
      const manifest = await generateCorpus(root);

      for (const classId of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]) {
        expect(manifest.pageClasses[classId]?.count).toBeGreaterThanOrEqual(5);
      }

      expect(manifest.databaseClasses.D1).toBeDefined();
      expect(manifest.databaseClasses.D2).toBeDefined();

      const fixtures = await readFixtureTree(root);
      const databaseFixtures = [...fixtures.entries()].filter(([name]) =>
        name.startsWith("databases/"),
      );

      expect(databaseFixtures.length).toBeGreaterThan(0);
      for (const [, content] of databaseFixtures) {
        expect(content).not.toContain('"type":"people"');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
