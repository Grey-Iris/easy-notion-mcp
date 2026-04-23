import type { ToolResultEvent, TranscriptData, ToolUseEvent } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readContentArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toolResultContentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
        return item.text;
      }

      return "";
    })
    .join("");
}

export function buildMcpConfig(url: string, bearer: string) {
  return {
    mcpServers: {
      "easy-notion": {
        type: "http",
        url,
        headers: {
          Authorization: `Bearer ${bearer}`,
        },
      },
    },
  };
}

export function parseStreamJson(ndjson: string): TranscriptData {
  const transcript: TranscriptData = {
    toolUses: [],
    toolResults: [],
    result: null,
    model: null,
    events: [],
  };

  for (const rawLine of ndjson.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(parsed)) {
      continue;
    }

    transcript.events.push(parsed);

    if (parsed.type === "system" && parsed.subtype === "init" && typeof parsed.model === "string") {
      transcript.model = parsed.model;
      continue;
    }

    if (parsed.type === "assistant") {
      const content = isRecord(parsed.message) ? readContentArray(parsed.message.content) : [];

      for (const item of content) {
        if (item.type !== "tool_use" || typeof item.id !== "string" || typeof item.name !== "string") {
          continue;
        }

        const toolUse: ToolUseEvent = {
          id: item.id,
          name: item.name,
          input: isRecord(item.input) ? item.input : {},
        };
        transcript.toolUses.push(toolUse);
      }

      continue;
    }

    if (parsed.type === "user") {
      const container = Array.isArray(parsed.content)
        ? parsed.content
        : isRecord(parsed.message) && Array.isArray(parsed.message.content)
          ? parsed.message.content
          : [];

      for (const item of readContentArray(container)) {
        if (item.type !== "tool_result" || typeof item.tool_use_id !== "string") {
          continue;
        }

        const toolResult: ToolResultEvent = {
          toolUseId: item.tool_use_id,
          content: toolResultContentToString(item.content),
        };
        transcript.toolResults.push(toolResult);
      }

      continue;
    }

    if (parsed.type === "result") {
      transcript.result = {
        text: typeof parsed.result === "string" ? parsed.result : "",
        costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0,
      };
    }
  }

  return transcript;
}
