import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scenario, ValidationError } from "./types.ts";

const VALID_SCENARIO_YAML = `
id: identity-smoke
tier: [A]
prompt: |
  Call get_me and report the bot id.
budget:
  max_turns: 4
  max_tokens: 1200
  max_usd: 0.1
transport: http
ground_truth:
  users:
    - must_include_bot: true
      size_min: 1
  tools_must_be_called: [get_me]
`.trim();

async function importLoader() {
  return import("./loader.ts");
}

function expectValidationError(result: Scenario | ValidationError, field?: string) {
  expect(result).toEqual(
    expect.objectContaining({
      error: expect.any(String),
      ...(field ? { field } : {}),
    }),
  );
}

describe("bench harness loader", () => {
  it("loads a valid scenario YAML string", async () => {
    const { parseScenario } = await importLoader();

    const result = parseScenario(VALID_SCENARIO_YAML);

    expect(result).not.toHaveProperty("error");
    expect(result).toEqual({
      id: "identity-smoke",
      tier: ["A"],
      prompt: "Call get_me and report the bot id.\n",
      budget: {
        max_turns: 4,
        max_tokens: 1200,
        max_usd: 0.1,
      },
      transport: "http",
      ground_truth: {
        users: [{ must_include_bot: true, size_min: 1 }],
        tools_must_be_called: ["get_me"],
      },
      scenarioDir: "",
    });
  });

  it("returns a validation error when id is missing", async () => {
    const { parseScenario } = await importLoader();

    const result = parseScenario(
      VALID_SCENARIO_YAML.replace("id: identity-smoke\n", ""),
    ) as Scenario | ValidationError;

    expectValidationError(result, "id");
  });

  it("returns a validation error when ground_truth is missing", async () => {
    const { parseScenario } = await importLoader();

    const result = parseScenario(
      VALID_SCENARIO_YAML.replace(
        /ground_truth:[\s\S]*$/,
        "",
      ).trim(),
    ) as Scenario | ValidationError;

    expectValidationError(result, "ground_truth");
  });

  it("returns a validation error for an unsupported tier value", async () => {
    const { parseScenario } = await importLoader();

    const result = parseScenario(
      VALID_SCENARIO_YAML.replace("tier: [A]", "tier: [C]"),
    ) as Scenario | ValidationError;

    expectValidationError(result, "tier");
  });

  it("ignores unknown keys", async () => {
    const { parseScenario } = await importLoader();

    const result = parseScenario(`
${VALID_SCENARIO_YAML}
extra_top_level: ignored
`);

    expect(result).not.toHaveProperty("error");
    expect((result as Scenario).id).toBe("identity-smoke");
    expect((result as Scenario).ground_truth.tools_must_be_called).toEqual(["get_me"]);
  });

  it("loads scenario.yaml from a scenario directory", async () => {
    const { loadScenario } = await importLoader();
    const scenarioDir = await mkdtemp(join(tmpdir(), "bench-loader-"));

    try {
      await writeFile(join(scenarioDir, "scenario.yaml"), VALID_SCENARIO_YAML, "utf8");

      const scenario = await loadScenario(scenarioDir);

      expect(scenario.id).toBe("identity-smoke");
      expect(scenario.transport).toBe("http");
      expect(scenario.ground_truth.users).toEqual([{ must_include_bot: true, size_min: 1 }]);
      expect(scenario.scenarioDir).toBe(scenarioDir);
    } finally {
      await rm(scenarioDir, { recursive: true, force: true });
    }
  });
});
