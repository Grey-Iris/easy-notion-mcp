import { encodingForModel } from "js-tiktoken";

const enc = encodingForModel("gpt-4");

export const ANTHROPIC_TOKEN_COUNT_MODEL = "claude-opus-4-8";
export const ANTHROPIC_VERSION = "2023-06-01";

export type AnthropicCountResult =
  | { available: false; reason: "no ANTHROPIC_API_KEY" }
  | { available: true; tokens: number; raw: unknown };

export interface CountAnthropicOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export function countCl100k(text: string): number {
  return enc.encode(text).length;
}

export function minifyToolsForSurface(tools: unknown[]): string {
  return JSON.stringify(tools);
}

export async function countAnthropic(
  text: string,
  opts: CountAnthropicOptions = {},
): Promise<AnthropicCountResult> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { available: false, reason: "no ANTHROPIC_API_KEY" };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const payload = {
    model: ANTHROPIC_TOKEN_COUNT_MODEL,
    messages: [
      {
        role: "user",
        content: text,
      },
    ],
  };

  // Phase 2 prerequisite: this is the real primary-tokenizer integration point.
  // Phase 1 normally runs without ANTHROPIC_API_KEY and must not fabricate a count.
  const response = await fetchImpl("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const raw: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`Anthropic token count failed (${response.status}): ${JSON.stringify(raw)}`);
  }

  const tokens = readInputTokens(raw);
  return { available: true, tokens, raw };
}

function readInputTokens(raw: unknown): number {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "input_tokens" in raw &&
    typeof raw.input_tokens === "number"
  ) {
    return raw.input_tokens;
  }
  throw new Error(`Anthropic token count response did not include input_tokens: ${JSON.stringify(raw)}`);
}
