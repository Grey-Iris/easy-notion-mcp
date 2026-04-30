import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { Scenario, ValidationError } from "./types.ts";

function validationError(error: string, field?: string): ValidationError {
  return { error, field };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTransport(value: unknown): value is Scenario["transport"] {
  return value === "stdio" || value === "http" || value === "any";
}

export function parseScenario(yamlContent: string): Scenario | ValidationError {
  let parsed: unknown;

  try {
    parsed = parse(yamlContent);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return validationError(`Invalid YAML: ${reason}`);
  }

  if (!isRecord(parsed)) {
    return validationError("Scenario must be a YAML object");
  }

  if (typeof parsed.id !== "string" || parsed.id.trim() === "") {
    return validationError("Scenario id is required", "id");
  }

  if (
    !Array.isArray(parsed.tier) ||
    parsed.tier.length === 0 ||
    parsed.tier.some((value) => value !== "A" && value !== "B")
  ) {
    return validationError('Scenario tier must contain only "A" or "B"', "tier");
  }

  if (typeof parsed.prompt !== "string") {
    return validationError("Scenario prompt is required", "prompt");
  }

  if (!isRecord(parsed.budget)) {
    return validationError("Scenario budget is required", "budget");
  }

  if (typeof parsed.budget.max_turns !== "number") {
    return validationError("budget.max_turns must be a number", "budget");
  }

  if (typeof parsed.budget.max_tokens !== "number") {
    return validationError("budget.max_tokens must be a number", "budget");
  }

  if (typeof parsed.budget.max_usd !== "number") {
    return validationError("budget.max_usd must be a number", "budget");
  }

  if (!isTransport(parsed.transport)) {
    return validationError("Scenario transport is invalid", "transport");
  }

  if (!isRecord(parsed.ground_truth)) {
    return validationError("Scenario ground_truth is required", "ground_truth");
  }

  return {
    id: parsed.id,
    tier: [...parsed.tier] as string[],
    prompt: parsed.prompt,
    budget: {
      max_turns: parsed.budget.max_turns,
      max_tokens: parsed.budget.max_tokens,
      max_usd: parsed.budget.max_usd,
    },
    transport: parsed.transport,
    ground_truth: parsed.ground_truth,
    scenarioDir: "",
  };
}

export async function loadScenario(scenarioDir: string): Promise<Scenario> {
  const scenarioPath = join(scenarioDir, "scenario.yaml");
  const yamlContent = await readFile(scenarioPath, "utf8");
  const parsed = parseScenario(yamlContent);

  if ("error" in parsed) {
    const suffix = parsed.field ? ` (${parsed.field})` : "";
    throw new Error(`Invalid scenario at ${scenarioPath}${suffix}: ${parsed.error}`);
  }

  return {
    ...parsed,
    scenarioDir,
  };
}

export async function loadAllScenarios(scenariosRoot: string): Promise<Scenario[]> {
  const entries = await readdir(scenariosRoot, { withFileTypes: true });
  const scenarioDirs = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const scenarioPath = join(scenariosRoot, entry.name, "scenario.yaml");

          try {
            await access(scenarioPath);
            return entry.name;
          } catch {
            return null;
          }
        }),
    )
  )
    .filter((dirName): dirName is string => dirName !== null)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(scenarioDirs.map((dirName) => loadScenario(join(scenariosRoot, dirName))));
}
