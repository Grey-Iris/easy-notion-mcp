/*
 * Recomputes read-axis token benchmark class factors and tier summaries.
 * Per-class factor is the median of five per-fixture baseline/ours ratios.
 * Tier aggregates are over per-class factors (k classes), superseding the
 * n=35 pooled-fixture median used in earlier drafts.
 *
 * MEASURED columns: completeness, as-consumed (anthropic/cl100k), common-IR.
 * MODELED columns: ours_calls / mk_calls — raw callCount was 0 for all rows in
 * this capture, so call count is synthetic (see callsForBlockChildren). Do not
 * treat the call-count output as a measurement.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OURS = "easy-notion";
const BASELINE = "makenotion";
const CLASSES = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"] as const;
const LOSSLESS_CLASSES = ["R2", "R3", "R4", "R6"] as const;
const HIGH_COMPLETENESS_CLASSES = ["R1", "R2", "R3", "R4", "R6"] as const;

type ClassId = (typeof CLASSES)[number];
type ServerId = typeof OURS | typeof BASELINE | "awkoy" | "better-notion";

type MetricNumbers = {
  cl100k: number;
  anthropic: number;
  bytes: number;
};

type BenchResult = {
  status: string;
  fixtureId: string;
  classId: ClassId;
  serverId: ServerId;
  numbers: {
    asConsumed: MetricNumbers;
    commonIr: MetricNumbers;
    contentCompleteness: { score: number };
    callCount: number;
  };
};

type ResultsFile = {
  results: BenchResult[];
};

type RawBlock = {
  children?: RawBlock[];
};

type RawFixture = {
  page: unknown;
  blocks: RawBlock[];
};

type ClassSummary = {
  classId: ClassId;
  completeness: number;
  asConsumedAnthropic: number;
  asConsumedCl100k: number;
  commonIrAnthropic: number;
  oursCalls: 1; // MODELED assumption, not measured (raw callCount=0); see callsForBlockChildren
  makenotionCalls: number; // MODELED estimate, not measured; see callsForBlockChildren
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot compute median of an empty list");
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot compute mean of an empty list");
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function geomean(values: readonly number[]): number {
  return Math.exp(mean(values.map((value) => Math.log(value))));
}

// ---------------------------------------------------------------------------
// MODELED call-count estimate — NOT a measurement.
// Raw `callCount` is 0 for all 160 rows in results.json (never captured), so the
// figures below are SYNTHETIC: ours is assumed to be 1 (see ClassSummary.oursCalls),
// and makenotion is modeled as `ceil(blocks/100)` paginated + one recursive fetch per
// parent-with-children, walked over the captured block tree. The block *structure* is
// real; the call total derived from it is a model. Do not present these as measured.
// A real measured comparison at equal completeness is future work (tasuku
// `bench-measure-call-counts`). Token / common-IR / completeness numbers ARE measured.
// ---------------------------------------------------------------------------
function callsForBlockChildren(blocks: readonly RawBlock[]): number {
  let calls = Math.max(1, Math.ceil(blocks.length / 100));

  for (const block of blocks) {
    if (Array.isArray(block.children) && block.children.length > 0) {
      calls += Math.max(1, Math.ceil(block.children.length / 100));
      calls += callsForNestedChildren(block.children);
    }
  }

  return calls;
}

function callsForNestedChildren(blocks: readonly RawBlock[]): number {
  let calls = 0;

  for (const block of blocks) {
    if (Array.isArray(block.children) && block.children.length > 0) {
      calls += Math.max(1, Math.ceil(block.children.length / 100));
      calls += callsForNestedChildren(block.children);
    }
  }

  return calls;
}

function makenotionCallCount(classId: ClassId, fixtureId: string): number {
  const rawPath = join(
    process.cwd(),
    ".meta",
    "bench",
    "read-axis",
    "raw",
    classId,
    `${fixtureId}--makenotion.json`,
  );
  const raw = readJson<RawFixture>(rawPath);
  return 1 + callsForBlockChildren(raw.blocks);
}

function byFixture(results: readonly BenchResult[], classId: ClassId, serverId: typeof OURS | typeof BASELINE): Map<string, BenchResult> {
  const pairs = new Map<string, BenchResult>();

  for (const result of results) {
    if (result.status === "ok" && result.classId === classId && result.serverId === serverId) {
      pairs.set(result.fixtureId, result);
    }
  }

  return pairs;
}

function ratio(baseline: number, ours: number): number {
  if (ours === 0) {
    throw new Error("Cannot compute ratio with zero denominator");
  }

  return baseline / ours;
}

function summarizeClass(results: readonly BenchResult[], classId: ClassId): ClassSummary {
  const oursByFixture = byFixture(results, classId, OURS);
  const baselineByFixture = byFixture(results, classId, BASELINE);
  const fixtureIds = [...oursByFixture.keys()].sort();

  if (fixtureIds.length !== 5) {
    throw new Error(`Expected 5 ${OURS} fixtures for ${classId}, got ${fixtureIds.length}`);
  }

  const asConsumedAnthropicRatios: number[] = [];
  const asConsumedCl100kRatios: number[] = [];
  const commonIrAnthropicRatios: number[] = [];
  const completenessScores: number[] = [];
  const makenotionCalls: number[] = [];

  for (const fixtureId of fixtureIds) {
    const ours = oursByFixture.get(fixtureId);
    const baseline = baselineByFixture.get(fixtureId);

    if (!ours || !baseline) {
      throw new Error(`Missing paired result for ${classId} ${fixtureId}`);
    }

    asConsumedAnthropicRatios.push(ratio(baseline.numbers.asConsumed.anthropic, ours.numbers.asConsumed.anthropic));
    asConsumedCl100kRatios.push(ratio(baseline.numbers.asConsumed.cl100k, ours.numbers.asConsumed.cl100k));
    commonIrAnthropicRatios.push(ratio(baseline.numbers.commonIr.anthropic, ours.numbers.commonIr.anthropic));
    completenessScores.push(ours.numbers.contentCompleteness.score);
    makenotionCalls.push(makenotionCallCount(classId, fixtureId));
  }

  return {
    classId,
    completeness: mean(completenessScores),
    asConsumedAnthropic: median(asConsumedAnthropicRatios),
    asConsumedCl100k: median(asConsumedCl100kRatios),
    commonIrAnthropic: median(commonIrAnthropicRatios),
    oursCalls: 1,
    makenotionCalls: median(makenotionCalls),
  };
}

function tierLine(label: string, summaries: readonly ClassSummary[], classIds: readonly ClassId[]): string {
  const factors = classIds.map((classId) => {
    const summary = summaries.find((candidate) => candidate.classId === classId);
    if (!summary) {
      throw new Error(`Missing summary for ${classId}`);
    }

    return summary.asConsumedAnthropic;
  });

  return `${label}: median=${median(factors).toFixed(2)} geomean=${geomean(factors).toFixed(2)} range=${Math.min(...factors).toFixed(1)}-${Math.max(...factors).toFixed(1)}`;
}

const resultsPath = join(process.cwd(), ".meta", "bench", "read-axis", "results.json");
const resultsFile = readJson<ResultsFile>(resultsPath);
const summaries = CLASSES.map((classId) => summarizeClass(resultsFile.results, classId));

console.log("NOTE: ours_calls / mk_calls are MODELED estimates (raw callCount=0 in capture), NOT measured.");
console.log("PER-CLASS (factor = median of 5 per-fixture ratios; ours=easy-notion baseline=makenotion)");
console.log("class  completeness  asConsumed_anth  cl100k  commonIR  ours_calls  mk_calls");

for (const summary of summaries) {
  console.log(
    `${summary.classId.padEnd(5)}  ${summary.completeness.toFixed(3).padEnd(12)}  ${summary.asConsumedAnthropic.toFixed(2).padEnd(15)}  ${summary.asConsumedCl100k.toFixed(2).padEnd(6)}  ${summary.commonIrAnthropic.toFixed(2).padEnd(8)}  ${String(summary.oursCalls).padEnd(10)}  ${Math.round(summary.makenotionCalls)}`,
  );
}

console.log("");
console.log("TIERS (aggregate over per-class asConsumed.anthropic factors)");
console.log(tierLine("Lossless (R2,R3,R4,R6)", summaries, LOSSLESS_CLASSES));
console.log(tierLine("High-completeness>=0.94 (+R1)", summaries, HIGH_COMPLETENESS_CLASSES));
