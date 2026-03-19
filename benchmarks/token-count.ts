import { encodingForModel } from "js-tiktoken";

type PartialUser = {
  object: "user";
  id: string;
};

type RichText = {
  type: "text";
  text: {
    content: string;
    link: { url: string } | null;
  };
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
  plain_text: string;
  href: string | null;
};

type PageParent =
  | { type: "page_id"; page_id: string }
  | { type: "database_id"; database_id: string };

type BlockParent = PageParent | { type: "block_id"; block_id: string };

type ListResponse<TType extends "block" | "page_or_database", TResult> = {
  object: "list";
  results: TResult[];
  next_cursor: null;
  has_more: false;
  type: TType;
} & Record<TType, Record<string, never>>;

const enc = encodingForModel("gpt-4");
const numberFormat = new Intl.NumberFormat("en-US");

const USERS = {
  alice: partialUser("0f8fad5b-d9cb-469f-a165-70867728950e"),
  ben: partialUser("7c9e6679-7425-40de-944b-e07fc1f90ae7"),
  cara: partialUser("550e8400-e29b-41d4-a716-446655440000"),
};

function partialUser(id: string): PartialUser {
  return { object: "user", id };
}

function richText(
  content: string,
  options: Partial<RichText["annotations"]> & { color?: string; link?: string } = {},
): RichText {
  const link = options.link ? { url: options.link } : null;
  return {
    type: "text",
    text: { content, link },
    annotations: {
      bold: options.bold ?? false,
      italic: options.italic ?? false,
      strikethrough: options.strikethrough ?? false,
      underline: options.underline ?? false,
      code: options.code ?? false,
      color: options.color ?? "default",
    },
    plain_text: content,
    href: link?.url ?? null,
  };
}

function titleProperty(id: string, value: string) {
  return {
    id,
    type: "title" as const,
    title: [richText(value)],
  };
}

function richTextProperty(id: string, value: string) {
  return {
    id,
    type: "rich_text" as const,
    rich_text: [richText(value)],
  };
}

function selectProperty(
  id: string,
  value: { id: string; name: string; color: string } | null,
) {
  return {
    id,
    type: "select" as const,
    select: value,
  };
}

function dateProperty(id: string, start: string | null) {
  return {
    id,
    type: "date" as const,
    date: start
      ? {
          start,
          end: null,
          time_zone: null,
        }
      : null,
  };
}

function pageObject(args: {
  id: string;
  createdTime: string;
  lastEditedTime: string;
  createdBy: PartialUser;
  lastEditedBy: PartialUser;
  cover: { type: "external"; external: { url: string } } | null;
  icon: { type: "emoji"; emoji: string } | null;
  parent: PageParent;
  properties: Record<string, unknown>;
  url: string;
  publicUrl?: string | null;
}) {
  return {
    object: "page" as const,
    id: args.id,
    created_time: args.createdTime,
    last_edited_time: args.lastEditedTime,
    created_by: args.createdBy,
    last_edited_by: args.lastEditedBy,
    cover: args.cover,
    icon: args.icon,
    parent: args.parent,
    archived: false,
    in_trash: false,
    properties: args.properties,
    url: args.url,
    public_url: args.publicUrl ?? null,
  };
}

function blockBase(args: {
  id: string;
  parent: BlockParent;
  createdTime: string;
  lastEditedTime: string;
  createdBy: PartialUser;
  lastEditedBy: PartialUser;
  hasChildren: boolean;
  type: string;
}) {
  return {
    object: "block" as const,
    id: args.id,
    parent: args.parent,
    created_time: args.createdTime,
    last_edited_time: args.lastEditedTime,
    created_by: args.createdBy,
    last_edited_by: args.lastEditedBy,
    has_children: args.hasChildren,
    archived: false,
    in_trash: false,
    type: args.type,
  };
}

function paginatedList<TType extends "block" | "page_or_database", TResult>(
  type: TType,
  results: TResult[],
): ListResponse<TType, TResult> {
  return {
    object: "list",
    results,
    next_cursor: null,
    has_more: false,
    type,
    [type]: {},
  } as ListResponse<TType, TResult>;
}

function countTokens(obj: unknown): number {
  return enc.encode(JSON.stringify(obj)).length;
}

function formatTokens(value: number): string {
  return `${numberFormat.format(value)} tokens`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function reduction(rawTokens: number, easyTokens: number): number {
  return ((rawTokens - easyTokens) / rawTokens) * 100;
}

const pageReadPage = pageObject({
  id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a1001",
  createdTime: "2025-01-15T10:30:00.000Z",
  lastEditedTime: "2025-01-15T11:02:00.000Z",
  createdBy: USERS.alice,
  lastEditedBy: USERS.ben,
  cover: {
    type: "external",
    external: {
      url: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4",
    },
  },
  icon: { type: "emoji", emoji: "📝" },
  parent: { type: "page_id", page_id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a0001" },
  properties: {
    title: titleProperty("title", "Meeting Notes"),
  },
  url: "https://www.notion.so/Meeting-Notes-b1f6c8d05c2e4f1b8e4e5d3f7c9a1001",
});

const pageReadTopLevelBlocks = [
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2001",
      parent: { type: "page_id", page_id: pageReadPage.id },
      createdTime: "2025-01-15T10:31:00.000Z",
      lastEditedTime: "2025-01-15T10:31:00.000Z",
      createdBy: USERS.alice,
      lastEditedBy: USERS.alice,
      hasChildren: false,
      type: "heading_2",
    }),
    heading_2: {
      rich_text: [richText("Decisions & Action Items")],
      color: "default",
      is_toggleable: false,
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2002",
      parent: { type: "page_id", page_id: pageReadPage.id },
      createdTime: "2025-01-15T10:32:00.000Z",
      lastEditedTime: "2025-01-15T10:35:00.000Z",
      createdBy: USERS.alice,
      lastEditedBy: USERS.ben,
      hasChildren: false,
      type: "paragraph",
    }),
    paragraph: {
      rich_text: [
        richText(
          "We aligned on shipping the benchmark script this week so we can quantify token savings against the raw Notion API output.",
        ),
      ],
      color: "default",
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2003",
      parent: { type: "page_id", page_id: pageReadPage.id },
      createdTime: "2025-01-15T10:35:30.000Z",
      lastEditedTime: "2025-01-15T10:36:00.000Z",
      createdBy: USERS.ben,
      lastEditedBy: USERS.ben,
      hasChildren: false,
      type: "paragraph",
    }),
    paragraph: {
      rich_text: [
        richText(
          "Action items are captured below for the backend and DX follow-ups so we can share the benchmark results with a single command.",
        ),
      ],
      color: "default",
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2004",
      parent: { type: "page_id", page_id: pageReadPage.id },
      createdTime: "2025-01-15T10:37:00.000Z",
      lastEditedTime: "2025-01-15T10:37:00.000Z",
      createdBy: USERS.ben,
      lastEditedBy: USERS.ben,
      hasChildren: false,
      type: "bulleted_list_item",
    }),
    bulleted_list_item: {
      rich_text: [richText("Confirm the fixture shapes match Notion block responses")],
      color: "default",
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2005",
      parent: { type: "page_id", page_id: pageReadPage.id },
      createdTime: "2025-01-15T10:37:10.000Z",
      lastEditedTime: "2025-01-15T10:37:10.000Z",
      createdBy: USERS.ben,
      lastEditedBy: USERS.ben,
      hasChildren: false,
      type: "bulleted_list_item",
    }),
    bulleted_list_item: {
      rich_text: [richText("Add token counting with js-tiktoken")],
      color: "default",
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2006",
      parent: { type: "page_id", page_id: pageReadPage.id },
      createdTime: "2025-01-15T10:37:20.000Z",
      lastEditedTime: "2025-01-15T10:37:20.000Z",
      createdBy: USERS.ben,
      lastEditedBy: USERS.ben,
      hasChildren: false,
      type: "bulleted_list_item",
    }),
    bulleted_list_item: {
      rich_text: [richText("Share the benchmark summary in the README once the numbers look stable")],
      color: "default",
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2007",
      parent: { type: "page_id", page_id: pageReadPage.id },
      createdTime: "2025-01-15T10:38:00.000Z",
      lastEditedTime: "2025-01-15T10:38:00.000Z",
      createdBy: USERS.cara,
      lastEditedBy: USERS.cara,
      hasChildren: false,
      type: "callout",
    }),
    callout: {
      rich_text: [
        richText(
          "Use the same content in both fixtures so the comparison reflects format overhead rather than wording differences.",
        ),
      ],
      icon: { type: "emoji", emoji: "💡" },
      color: "gray_background",
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2008",
      parent: { type: "page_id", page_id: pageReadPage.id },
      createdTime: "2025-01-15T10:39:00.000Z",
      lastEditedTime: "2025-01-15T10:40:00.000Z",
      createdBy: USERS.alice,
      lastEditedBy: USERS.alice,
      hasChildren: false,
      type: "code",
    }),
    code: {
      caption: [],
      rich_text: [
        richText('const enc = encodingForModel("gpt-4");\nconst tokens = enc.encode(JSON.stringify(payload)).length;', {
          code: true,
        }),
      ],
      language: "typescript",
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2009",
      parent: { type: "page_id", page_id: pageReadPage.id },
      createdTime: "2025-01-15T10:41:00.000Z",
      lastEditedTime: "2025-01-15T10:41:00.000Z",
      createdBy: USERS.cara,
      lastEditedBy: USERS.cara,
      hasChildren: true,
      type: "table",
    }),
    table: {
      table_width: 3,
      has_column_header: true,
      has_row_header: false,
    },
  },
];

const pageReadTableRows = [
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2010",
      parent: { type: "block_id", block_id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2009" },
      createdTime: "2025-01-15T10:41:10.000Z",
      lastEditedTime: "2025-01-15T10:41:10.000Z",
      createdBy: USERS.cara,
      lastEditedBy: USERS.cara,
      hasChildren: false,
      type: "table_row",
    }),
    table_row: {
      cells: [
        [richText("Owner", { bold: true })],
        [richText("Decision", { bold: true })],
        [richText("Due", { bold: true })],
      ],
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2011",
      parent: { type: "block_id", block_id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2009" },
      createdTime: "2025-01-15T10:41:20.000Z",
      lastEditedTime: "2025-01-15T10:41:20.000Z",
      createdBy: USERS.cara,
      lastEditedBy: USERS.cara,
      hasChildren: false,
      type: "table_row",
    }),
    table_row: {
      cells: [
        [richText("Alice")],
        [richText("Finalize fixture data")],
        [richText("2025-01-16")],
      ],
    },
  },
  {
    ...blockBase({
      id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2012",
      parent: { type: "block_id", block_id: "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2009" },
      createdTime: "2025-01-15T10:41:30.000Z",
      lastEditedTime: "2025-01-15T10:41:30.000Z",
      createdBy: USERS.cara,
      lastEditedBy: USERS.cara,
      hasChildren: false,
      type: "table_row",
    }),
    table_row: {
      cells: [
        [richText("Ben")],
        [richText("Review output formatting")],
        [richText("2025-01-17")],
      ],
    },
  },
];

const pageReadRaw = {
  page: pageReadPage,
  block_children: paginatedList("block", pageReadTopLevelBlocks),
  child_block_children: {
    "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2009": paginatedList("block", pageReadTableRows),
  },
};

const pageReadEasy = {
  id: pageReadPage.id,
  title: "Meeting Notes",
  url: pageReadPage.url,
  markdown: [
    "## Decisions & Action Items",
    "",
    "We aligned on shipping the benchmark script this week so we can quantify token savings against the raw Notion API output.",
    "",
    "Action items are captured below for the backend and DX follow-ups so we can share the benchmark results with a single command.",
    "",
    "- Confirm the fixture shapes match Notion block responses",
    "- Add token counting with js-tiktoken",
    "- Share the benchmark summary in the README once the numbers look stable",
    "",
    "> [!NOTE]",
    "> Use the same content in both fixtures so the comparison reflects format overhead rather than wording differences.",
    "",
    "```ts",
    'const enc = encodingForModel("gpt-4");',
    "const tokens = enc.encode(JSON.stringify(payload)).length;",
    "```",
    "",
    "| Owner | Decision | Due |",
    "| --- | --- | --- |",
    "| Alice | Finalize fixture data | 2025-01-16 |",
    "| Ben | Review output formatting | 2025-01-17 |",
  ].join("\n"),
};

const taskPages = [
  {
    id: "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5001",
    title: "Ship benchmark script",
    status: { id: "sel-status-1", name: "In Progress", color: "yellow" },
    priority: { id: "sel-priority-1", name: "High", color: "red" },
    dueDate: "2025-01-15",
    assignee: "Alice",
    icon: { type: "emoji" as const, emoji: "🚧" },
  },
  {
    id: "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5002",
    title: "Review fixture accuracy",
    status: { id: "sel-status-2", name: "Not Started", color: "default" },
    priority: { id: "sel-priority-2", name: "Medium", color: "yellow" },
    dueDate: "2025-01-16",
    assignee: "Ben",
    icon: { type: "emoji" as const, emoji: "🔍" },
  },
  {
    id: "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5003",
    title: "Document benchmark results",
    status: { id: "sel-status-3", name: "Blocked", color: "red" },
    priority: { id: "sel-priority-3", name: "Low", color: "gray" },
    dueDate: "2025-01-18",
    assignee: "Cara",
    icon: { type: "emoji" as const, emoji: "📚" },
  },
  {
    id: "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5004",
    title: "Backfill README examples",
    status: { id: "sel-status-4", name: "Done", color: "green" },
    priority: { id: "sel-priority-4", name: "Medium", color: "yellow" },
    dueDate: "2025-01-14",
    assignee: "Alice",
    icon: { type: "emoji" as const, emoji: "✅" },
  },
  {
    id: "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5005",
    title: "Share benchmark in team update",
    status: { id: "sel-status-5", name: "Done", color: "green" },
    priority: { id: "sel-priority-5", name: "High", color: "red" },
    dueDate: "2025-01-20",
    assignee: "Ben",
    icon: { type: "emoji" as const, emoji: "📣" },
  },
];

const queryDatabaseRaw = paginatedList(
  "page_or_database",
  taskPages.map((task, index) =>
    pageObject({
      id: task.id,
      createdTime: `2025-01-${String(10 + index).padStart(2, "0")}T09:00:00.000Z`,
      lastEditedTime: `2025-01-${String(12 + index).padStart(2, "0")}T14:15:00.000Z`,
      createdBy: index % 2 === 0 ? USERS.alice : USERS.ben,
      lastEditedBy: index % 2 === 0 ? USERS.cara : USERS.alice,
      cover: null,
      icon: task.icon,
      parent: { type: "database_id", database_id: "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d4000" },
      properties: {
        Title: titleProperty("title", task.title),
        Status: selectProperty("P%3AKY", task.status),
        Priority: selectProperty("Yc%3AN", task.priority),
        "Due Date": dateProperty("QyRn", task.dueDate),
        Assignee: richTextProperty("f%5D%7BV", task.assignee),
      },
      url: `https://www.notion.so/${task.title.replace(/\s+/g, "-")}-${task.id.replace(/-/g, "")}`,
    }),
  ),
);

const queryDatabaseEasy = taskPages.map((task) => ({
  id: task.id,
  Title: task.title,
  Status: task.status.name,
  Priority: task.priority.name,
  "Due Date": task.dueDate,
  Assignee: task.assignee,
}));

const searchPages = [
  {
    id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6001",
    title: "Engineering Weekly Notes",
    icon: { type: "emoji" as const, emoji: "📓" },
    parent: { type: "page_id" as const, page_id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6000" },
  },
  {
    id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6002",
    title: "Benchmark Rollout Plan",
    icon: { type: "emoji" as const, emoji: "🗺️" },
    parent: { type: "page_id" as const, page_id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6000" },
  },
  {
    id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6003",
    title: "SDK Migration Checklist",
    icon: { type: "emoji" as const, emoji: "🧭" },
    parent: { type: "page_id" as const, page_id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6000" },
  },
  {
    id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6004",
    title: "API Payload Comparison",
    icon: { type: "emoji" as const, emoji: "📊" },
    parent: { type: "page_id" as const, page_id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6000" },
  },
  {
    id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6005",
    title: "Search Result Audit",
    icon: { type: "emoji" as const, emoji: "🔎" },
    parent: { type: "page_id" as const, page_id: "9d5ed678-fe57-4cca-8d10-1a2b3c4d6000" },
  },
];

const searchRaw = paginatedList(
  "page_or_database",
  searchPages.map((page, index) =>
    pageObject({
      id: page.id,
      createdTime: `2025-01-${String(5 + index).padStart(2, "0")}T08:20:00.000Z`,
      lastEditedTime: `2025-01-${String(9 + index).padStart(2, "0")}T16:45:00.000Z`,
      createdBy: index % 2 === 0 ? USERS.cara : USERS.alice,
      lastEditedBy: index % 2 === 0 ? USERS.ben : USERS.cara,
      cover: null,
      icon: page.icon,
      parent: page.parent,
      properties: {
        title: titleProperty("title", page.title),
      },
      url: `https://www.notion.so/${page.title.replace(/\s+/g, "-")}-${page.id.replace(/-/g, "")}`,
    }),
  ),
);

const searchEasy = searchPages.map((page) => ({
  id: page.id,
  type: "page",
  title: page.title,
  url: `https://www.notion.so/${page.title.replace(/\s+/g, "-")}-${page.id.replace(/-/g, "")}`,
}));

const benchmarks = [
  {
    label: "Page read",
    rawLabel: "Page Read",
    raw: pageReadRaw,
    easy: pageReadEasy,
    weight: 0.4,
  },
  {
    label: "Database query (5 entries)",
    rawLabel: "Database Query",
    raw: queryDatabaseRaw,
    easy: queryDatabaseEasy,
    weight: 0.4,
  },
  {
    label: "Search (5 results)",
    rawLabel: "Search",
    raw: searchRaw,
    easy: searchEasy,
    weight: 0.2,
  },
];

const measured = benchmarks.map((benchmark) => {
  const rawTokens = countTokens(benchmark.raw);
  const easyTokens = countTokens(benchmark.easy);
  return {
    ...benchmark,
    rawTokens,
    easyTokens,
    reduction: reduction(rawTokens, easyTokens),
  };
});

const weightedAverage = measured.reduce(
  (sum, benchmark) => sum + benchmark.reduction * benchmark.weight,
  0,
);

const lines = [
  "## Token Efficiency Benchmark",
  "",
  "| Operation | Raw Notion API | easy-notion-mcp | Reduction |",
  "|-----------|---------------|-----------------|-----------|",
  ...measured.map(
    (benchmark) =>
      `| ${benchmark.label} | ${formatTokens(benchmark.rawTokens)} | ${formatTokens(benchmark.easyTokens)} | ${formatPercent(benchmark.reduction)} |`,
  ),
  `| **Weighted average** |  |  | **${formatPercent(weightedAverage)}** |`,
  "",
  "## Fixture Data",
  "",
];

for (const benchmark of measured) {
  lines.push(
    `### ${benchmark.rawLabel} — Raw Notion API (${formatTokens(benchmark.rawTokens)})`,
    "```json",
    JSON.stringify(benchmark.raw, null, 2),
    "```",
    "",
    `### ${benchmark.rawLabel} — easy-notion-mcp (${formatTokens(benchmark.easyTokens)})`,
    "```json",
    JSON.stringify(benchmark.easy, null, 2),
    "```",
    "",
  );
}

console.log(lines.join("\n"));
