export type ServerId = "easy-notion" | "makenotion" | "awkoy" | "better-notion";

export interface ServerDef {
  id: ServerId;
  label: string;
  kind: "local" | "git";
  repo?: string;
  pinnedSha?: string;
  expectedPkgVersion: string;
  notionVersion: string;
  expectedTools: number;
}

export const SERVERS: ServerDef[] = [
  {
    id: "easy-notion",
    label: "easy-notion-mcp (ours)",
    kind: "local",
    expectedPkgVersion: "0.9.3",
    notionVersion: "2026-03-11",
    expectedTools: 42,
  },
  {
    id: "makenotion",
    label: "makenotion/notion-mcp-server",
    kind: "git",
    repo: "https://github.com/makenotion/notion-mcp-server",
    pinnedSha: "e79f35fd64cc5db726fbba1beebaa84c80760c17",
    expectedPkgVersion: "2.3.1",
    notionVersion: "2025-09-03",
    expectedTools: 22,
  },
  {
    id: "awkoy",
    label: "awkoy/notion-mcp-server",
    kind: "git",
    repo: "https://github.com/awkoy/notion-mcp-server",
    pinnedSha: "f5f1bdaf2456093a583722dab8422cf7b972636c",
    expectedPkgVersion: "2.5.1",
    notionVersion: "2025-09-03",
    expectedTools: 2,
  },
  {
    id: "better-notion",
    label: "better-notion-mcp (@n24q02m)",
    kind: "git",
    repo: "https://github.com/n24q02m/better-notion-mcp",
    pinnedSha: "7c56493eb60af7d8c2e9d0306b649e96ddcabcc7",
    expectedPkgVersion: "2.34.8-beta.3",
    notionVersion: "2025-09-03",
    expectedTools: 11,
  },
];
