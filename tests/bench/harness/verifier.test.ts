import { describe, expect, it, vi } from "vitest";
import type { GroundTruth, TranscriptData } from "./types.ts";
import type { SdkContext } from "./verifier.ts";

async function importVerifier() {
  return import("./verifier.ts");
}

function makeTranscript(overrides: Partial<TranscriptData> = {}): TranscriptData {
  return {
    toolUses: [],
    toolResults: [],
    result: null,
    model: null,
    events: [],
    ...overrides,
  };
}

function makeRow(title: string, extra: Record<string, unknown> = {}) {
  return {
    id: `${title}-id`,
    properties: {
      Title: {
        type: "title",
        title: [{ plain_text: title }],
      },
      ...extra,
    },
  };
}

function makeSdkContext(overrides: Partial<SdkContext> = {}): SdkContext {
  return {
    listUsers: vi.fn().mockResolvedValue([]),
    findChildPages: vi.fn().mockResolvedValue([]),
    findChildDatabases: vi.fn().mockResolvedValue([]),
    getPageContent: vi.fn().mockResolvedValue(""),
    queryDatabase: vi.fn().mockResolvedValue([]),
    listComments: vi.fn().mockResolvedValue([]),
    getDatabase: vi.fn().mockResolvedValue({
      id: "db-default",
      title: "Default DB",
      properties: {},
    }),
    ...overrides,
  };
}

describe("bench harness verifier", () => {
  it("passes users.must_include_bot when the SDK user list contains a bot", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      listUsers: vi.fn().mockResolvedValue([
        { id: "user-1", type: "person", name: "Alice" },
        { id: "user-2", type: "bot", name: "Bench Bot" },
      ]),
    });

    const result = await verifyGroundTruth(
      { users: [{ must_include_bot: true }] },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim: "users[0]",
          passed: true,
        }),
      ]),
    );
  });

  it("soft-warns when a required tool was not called", async () => {
    const { verifyGroundTruth } = await importVerifier();

    const result = await verifyGroundTruth(
      { tools_must_be_called: ["get_me"] },
      makeTranscript(),
      makeSdkContext(),
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/get_me/i)]),
    );
  });

  it("passes pages.title_matches when a page exists under the scenario parent", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildPages: vi.fn().mockResolvedValue([
        { id: "page-1", title: "Weekly eng sync" },
      ]),
    });

    const result = await verifyGroundTruth(
      {
        pages: [{ title_matches: "Weekly eng" }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
    expect(result.claims).toEqual(
      expect.arrayContaining([expect.objectContaining({ claim: "pages[0]", passed: true })]),
    );
  });

  it("fails pages.title_matches when the page is missing", async () => {
    const { verifyGroundTruth } = await importVerifier();

    const result = await verifyGroundTruth(
      {
        pages: [{ title_matches: "Weekly eng" }],
      },
      makeTranscript(),
      makeSdkContext(),
      "scenario-parent",
    );

    expect(result.passed).toBe(false);
    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim: "pages[0]",
          passed: false,
          message: expect.stringMatching(/weekly eng/i),
        }),
      ]),
    );
  });

  it("passes pages.must_contain_blocks when markdown contains the expected blocks", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildPages: vi.fn().mockResolvedValue([{ id: "page-1", title: "Weekly eng sync" }]),
      getPageContent: vi.fn().mockResolvedValue([
        "## Attendees",
        "",
        "## Action Items",
        "",
        "- [ ] Follow up on flaky tests",
        "- [ ] Add staging checks",
        "- [ ] Document deploy rollback",
      ].join("\n")),
    });

    const result = await verifyGroundTruth(
      {
        pages: [{
          title_matches: "Weekly eng",
          must_contain_blocks: [
            { type: "heading_2", text: "Attendees" },
            { type: "to_do", count_min: 3 },
          ],
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
  });

  it("fails pages.must_contain_blocks when a required block is missing", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildPages: vi.fn().mockResolvedValue([{ id: "page-1", title: "Weekly eng sync" }]),
      getPageContent: vi.fn().mockResolvedValue("## Discussion"),
    });

    const result = await verifyGroundTruth(
      {
        pages: [{
          title_matches: "Weekly eng",
          must_contain_blocks: [{ type: "heading_2", text: "Action Items" }],
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(false);
    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim: "pages[0]",
          passed: false,
          message: expect.stringMatching(/Action Items/),
        }),
      ]),
    );
  });

  it("passes pages.icon when the page icon matches the expected emoji", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildPages: vi.fn().mockResolvedValue([
        { id: "page-1", title: "Announcing Our New API", icon: { type: "emoji", emoji: "🚀" } },
      ]),
    });

    const result = await verifyGroundTruth(
      {
        pages: [{
          title_matches: "Announcing Our New API",
          icon: { type: "emoji", emoji: "🚀" },
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
  });

  it("passes databases.must_have_properties when all requested properties exist", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildDatabases: vi.fn().mockResolvedValue([
        {
          id: "db-1",
          title: "Bug Tracker",
          properties: {
            Status: { type: "select" },
            Priority: { type: "select" },
            Description: { type: "rich_text" },
            Tags: { type: "relation" },
          },
        },
      ]),
    });

    const result = await verifyGroundTruth(
      {
        databases: [{
          title_matches: "Bug Tracker",
          must_have_properties: [
            { name: "Status", type: "select" },
            { name: "Tags", type: "relation" },
          ],
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
  });

  it("fails databases.requested_schema with fail policy when schema entries are missing", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildDatabases: vi.fn().mockResolvedValue([
        {
          id: "db-1",
          title: "Bibliography",
          properties: {
            Title: { type: "title" },
            Authors: { type: "rich_text" },
          },
        },
      ]),
    });

    const result = await verifyGroundTruth(
      {
        databases: [{
          title_matches: "Bibliography",
          requested_schema: [
            { name: "Authors", type: "rich_text" },
            { name: "Impact Factor", type: "number" },
          ],
          schema_drop_policy: "fail",
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(false);
    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim: "databases[0]",
          passed: false,
          message: expect.stringMatching(/Impact Factor/),
        }),
      ]),
    );
  });

  it("passes rows.size_min when enough rows exist", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildDatabases: vi.fn().mockResolvedValue([
        { id: "db-1", title: "Bug Tracker", properties: {} },
      ]),
      queryDatabase: vi.fn().mockResolvedValue([
        makeRow("Auth timeout on login"),
        makeRow("Dashboard CSS glitch"),
        makeRow("API rate limit exceeded"),
      ]),
    });

    const result = await verifyGroundTruth(
      {
        rows: [{
          database_title_matches: "Bug Tracker",
          size_min: 3,
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
  });

  it("passes rows.must_exist when a matching row has the expected values", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildDatabases: vi.fn().mockResolvedValue([
        { id: "db-1", title: "Bug Tracker", properties: {} },
      ]),
      queryDatabase: vi.fn().mockResolvedValue([
        makeRow("Auth timeout on login", {
          Status: { type: "status", status: { name: "In Progress" } },
        }),
      ]),
    });

    const result = await verifyGroundTruth(
      {
        rows: [{
          database_title_matches: "Bug Tracker",
          must_exist: [{
            match: { Title: "Auth timeout on login" },
            expect: { Status: "In Progress" },
          }],
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
  });

  it("passes query claims when the filtered results include the expected titles", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const queryDatabase = vi.fn().mockResolvedValue([
      makeRow("AI Trends Analysis"),
      makeRow("Customer Success Story"),
    ]);
    const sdkContext = makeSdkContext({
      findChildDatabases: vi.fn().mockResolvedValue([
        { id: "db-1", title: "Editorial Calendar", properties: {} },
      ]),
      queryDatabase,
    });
    const filter = {
      and: [
        { property: "Status", status: { equals: "Not started" } },
        { property: "Publish Date", date: { before: "2025-05-01" } },
      ],
    };

    const result = await verifyGroundTruth(
      {
        query: [{
          database_title_matches: "Editorial Calendar",
          filter,
          result_must_include_titles: ["AI Trends Analysis"],
          result_size_min: 1,
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
    expect(queryDatabase).toHaveBeenCalledWith("db-1", filter);
  });

  it("checks pages_under_parent include and exclude title lists", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildPages: vi.fn().mockResolvedValue([
        { id: "page-1", title: "Sprint 40" },
        { id: "page-2", title: "Sprint 41" },
      ]),
    });

    const passing = await verifyGroundTruth(
      {
        pages_under_parent: [{
          must_include_titles: ["Sprint 40", "Sprint 41"],
          must_not_include_titles: ["Sprint 39"],
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    const failing = await verifyGroundTruth(
      {
        pages_under_parent: [{
          must_include_titles: ["Sprint 39"],
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(passing.passed).toBe(true);
    expect(failing.passed).toBe(false);
  });

  it("passes comments.must_include_ordered when comments appear in order", async () => {
    const { verifyGroundTruth } = await importVerifier();
    const sdkContext = makeSdkContext({
      findChildPages: vi.fn().mockResolvedValue([
        { id: "page-1", title: "New Hire Onboarding" },
      ]),
      listComments: vi.fn().mockResolvedValue([
        { id: "comment-1", authorType: "bot", body: "Welcome aboard! Please complete these items in your first week." },
        { id: "comment-2", authorType: "bot", body: "Security training link: https://example.com/training" },
      ]),
    });

    const result = await verifyGroundTruth(
      {
        comments: [{
          page_title_matches: "New Hire Onboarding",
          size_min: 2,
          must_include_ordered: [
            { body_contains: "Welcome aboard" },
            { body_contains: "Security training" },
          ],
        }],
      },
      makeTranscript(),
      sdkContext,
      "scenario-parent",
    );

    expect(result.passed).toBe(true);
  });

  it("hard-fails tools_must_not_be_called when a forbidden tool appears in the transcript", async () => {
    const { verifyGroundTruth } = await importVerifier();

    const result = await verifyGroundTruth(
      {
        tools_must_not_be_called: ["delete_database_entry"],
      },
      makeTranscript({
        toolUses: [
          {
            id: "toolu-1",
            name: "mcp__easy-notion__delete_database_entry",
            input: {},
          },
        ],
      }),
      makeSdkContext(),
      "scenario-parent",
    );

    expect(result.passed).toBe(false);
    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim: "tools_must_not_be_called",
          passed: false,
          message: expect.stringMatching(/delete_database_entry/),
        }),
      ]),
    );
  });
});
