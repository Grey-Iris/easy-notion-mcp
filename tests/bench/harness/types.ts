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
  scenarioDir: string;
}

export interface GroundTruth {
  users?: UsersClaim[];
  tools_must_be_called?: string[];
  tools_must_not_be_called?: string[];
  pages?: PageClaim[];
  databases?: DatabaseClaim[];
  rows?: RowsClaim[];
  query?: QueryClaim[];
  pages_under_parent?: PagesUnderParentClaim[];
  comments?: CommentsClaim[];
  schema_drop_detection?: SchemaDropDetectionClaim[];
}

export interface UsersClaim {
  must_include_bot?: boolean;
  size_min?: number;
}

export interface PageClaim {
  parent?: string;
  title_matches: string;
  must_contain_blocks?: Array<{
    type: string;
    text?: string;
    count_min?: number;
    count_max?: number;
  }>;
  must_round_trip_clean?: boolean;
  only_section_changed?: string;
  icon?: { type: string; emoji?: string; external?: string };
  cover?: { type: string; external?: string };
}

export interface DatabaseClaim {
  parent?: string;
  title_matches: string;
  must_have_properties?: Array<{ name: string; type: string }>;
  requested_schema?: Array<{ name: string; type: string }>;
  schema_drop_policy?: "fail" | "warn" | "ignore";
}

export interface RowsClaim {
  database_title_matches: string;
  must_exist?: Array<{ match: Record<string, string>; expect?: Record<string, string> }>;
  must_not_exist?: Array<{ match: Record<string, string> }>;
  size_min?: number;
  size_max?: number;
}

export interface QueryClaim {
  database_title_matches: string;
  filter?: Record<string, unknown>;
  result_must_include_titles?: string[];
  result_must_not_include_titles?: string[];
  result_size_min?: number;
  result_size_max?: number;
}

export interface PagesUnderParentClaim {
  parent?: string;
  must_include_titles?: string[];
  must_not_include_titles?: string[];
}

export interface CommentsClaim {
  page_title_matches: string;
  must_include_ordered?: Array<{ author_is_bot?: boolean; body_contains: string }>;
  size_min?: number;
}

export interface SchemaDropDetectionClaim {
  database_title_matches: string;
  must_not_have_missing_properties: boolean;
}

export interface AssertContext {
  notion: import("@notionhq/client").Client;
  scenarioParentId: string;
  transcript: TranscriptData;
}

export interface AssertResult {
  passed: boolean;
  message?: string;
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
  status: "pass" | "fail" | "skip";
  durationMs: number;
  costUsd: number;
  transcript: TranscriptData;
  verification: VerifyResult;
  transcriptPath?: string;
  transcriptSha256?: string;
}

export interface ManifestClaim {
  kind: string;
  index: number;
  status: "pass" | "fail";
  reason?: string;
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
    status: "pass" | "fail" | "skip";
    duration_ms: number;
    cost_usd: number;
    transcript_path: string;
    transcript_sha256: string;
    claims: ManifestClaim[];
  }>;
  totals: {
    scenarios_run: number;
    passed: number;
    failed: number;
    skipped: number;
    cost_usd: number;
  };
}

export type ValidationError = { error: string; field?: string };
