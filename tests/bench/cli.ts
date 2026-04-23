#!/usr/bin/env npx tsx

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllScenarios } from "./harness/loader.ts";
import { runBenchHarness } from "./harness/runner.ts";

function usage(): string {
  return [
    "Bench harness CLI — run scenarios against a dispatched Claude agent",
    "Usage: npx tsx tests/bench/cli.ts [--scenarios <ids...>] [--help]",
  ].join("\n");
}

function parseArgs(argv: string[]): { scenarioFilters: string[]; help: boolean } {
  const scenarioFilters: string[] = [];
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      help = true;
      continue;
    }

    if (arg === "--scenarios") {
      while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
        scenarioFilters.push(argv[index + 1]);
        index += 1;
      }
      continue;
    }
  }

  return { scenarioFilters, help };
}

async function main() {
  const { scenarioFilters, help } = parseArgs(process.argv.slice(2));

  if (help) {
    console.log(usage());
    return;
  }

  const benchDir = dirname(fileURLToPath(import.meta.url));
  const scenariosRoot = resolve(benchDir, "scenarios");
  const scenarios = await loadAllScenarios(scenariosRoot);
  const selectedScenarios =
    scenarioFilters.length === 0
      ? scenarios
      : scenarios.filter((scenario) =>
          scenarioFilters.some((filter) => scenario.id.includes(filter)),
        );

  if (selectedScenarios.length === 0) {
    console.error("No scenarios matched the provided filters.");
    return 1;
  }

  const result = await runBenchHarness(selectedScenarios);
  return result.exitCode;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}).then((exitCode) => {
  if (typeof exitCode === "number") {
    process.exitCode = exitCode;
  }
});
