export interface Scenario {
  id: string;
  tier: string[];
  prompt: string;
  budget: {
    max_turns: number;
    max_tokens: number;
    max_usd: number;
  };
  transport: "stdio" | "http" | "any";
  ground_truth: GroundTruth;
}

export interface GroundTruth {
  users?: UsersClaim[];
  tools_must_be_called?: string[];
  tools_must_not_be_called?: string[];
  // PR-A1 will add: pages, databases, rows, query, pages_under_parent, comments, schema_drop_detection
}

export interface UsersClaim {
  must_include_bot?: boolean;
  size_min?: number;
}

export interface ToolUseEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  toolUseId: string;
  content: string;
}

export interface TranscriptData {
  toolUses: ToolUseEvent[];
  toolResults: ToolResultEvent[];
  result: { text: string; costUsd: number } | null;
  model: string | null;
  events: Array<Record<string, unknown>>;
}

export interface ClaimResult {
  passed: boolean;
  claim: string;
  message?: string;
  warnings?: string[];
}

export interface VerifyResult {
  passed: boolean;
  claims: ClaimResult[];
  warnings: string[];
}

export interface ScenarioResult {
  id: string;
  passed: boolean;
  durationMs: number;
  costUsd: number;
  transcript: TranscriptData;
  verification: VerifyResult;
  transcriptPath?: string;
  transcriptSha256?: string;
}

export interface RunManifest {
  run_id: string;
  git_sha: string;
  git_branch: string;
  started_at: string;
  finished_at: string;
  model: string;
  node_version: string;
  scenarios: Array<{
    id: string;
    passed: boolean;
    duration_ms: number;
    cost_usd: number;
    transcript_path: string;
    transcript_sha256: string;
  }>;
  totals: {
    scenarios_run: number;
    passed: number;
    failed: number;
    cost_usd: number;
  };
}

export type ValidationError = { error: string; field?: string };
