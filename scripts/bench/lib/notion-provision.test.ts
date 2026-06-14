import { describe, expect, it, vi } from "vitest";

import type { DatabaseFixture, PageFixture } from "../corpus/generate.js";
import { provisionDatabase, provisionPage } from "./notion-provision.js";

interface RecordedRequest {
  url: string;
  method: string;
  body?: any;
}

describe("notion provision", () => {
  it("preserves paragraph annotation colors as rich_text spans", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl = fakeFetch(requests);
    const fixture: PageFixture = {
      id: "R5-01",
      classId: "R5",
      label: "annotations",
      title: "Annotated page",
      blocks: [
        {
          type: "paragraph",
          text: "alpha beta gamma",
          annotations: [{ start: 6, end: 10, color: "red", bold: true }],
        },
      ],
    };

    await provisionPage(fixture, "parent-page", { token: "secret", fetchImpl });

    const createPage = requests.find((request) => request.method === "POST" && request.url.endsWith("/v1/pages"));
    const richText = createPage?.body.children[0].paragraph.rich_text;
    expect(richText).toEqual([
      { type: "text", text: { content: "alpha " } },
      { type: "text", text: { content: "beta" }, annotations: { color: "red", bold: true } },
      { type: "text", text: { content: " gamma" } },
    ]);
  });

  it("recursively appends deeply nested children", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl = fakeFetch(requests);
    const fixture: PageFixture = {
      id: "R7-01",
      classId: "R7",
      label: "deep",
      title: "Deep page",
      blocks: [
        {
          type: "toggle",
          text: "level 1",
          children: [
            {
              type: "bulleted_list_item",
              text: "level 2",
              children: [
                {
                  type: "toggle",
                  text: "level 3",
                  children: [{ type: "paragraph", text: "level 4" }],
                },
              ],
            },
          ],
        },
      ],
    };

    await provisionPage(fixture, "parent-page", { token: "secret", fetchImpl });

    const appendCalls = requests.filter((request) => request.method === "PATCH" && request.url.includes("/children"));
    expect(appendCalls.length).toBeGreaterThanOrEqual(3);
    expect(appendCalls.map((request) => request.body.children[0].type)).toEqual([
      "bulleted_list_item",
      "toggle",
      "paragraph",
    ]);
  });

  it("splits more than 100 top-level blocks across create and append requests", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl = fakeFetch(requests);
    const fixture: PageFixture = {
      id: "wide",
      classId: "R4",
      label: "wide",
      title: "Wide page",
      blocks: Array.from({ length: 105 }, (_, index) => ({ type: "paragraph", text: `Block ${index + 1}` })),
    };

    await provisionPage(fixture, "parent-page", { token: "secret", fetchImpl });

    const createPage = requests.find((request) => request.method === "POST" && request.url.endsWith("/v1/pages"));
    const appendCalls = requests.filter((request) => request.method === "PATCH" && request.url.includes("/children"));
    expect(createPage?.body.children).toHaveLength(100);
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]?.body.children).toHaveLength(5);
    for (const request of requests) {
      const children = request.body?.children;
      if (Array.isArray(children)) {
        expect(children.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it("creates a database and rows with Notion property value shapes", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl = fakeFetch(requests);
    const fixture: DatabaseFixture = {
      id: "D1",
      classId: "D1",
      label: "db",
      title: "Bench database",
      properties: [
        { name: "Name", type: "title" },
        { name: "Summary", type: "rich_text" },
        { name: "Estimate", type: "number" },
        { name: "Priority", type: "select", options: ["Low", "High"] },
        { name: "Tags", type: "multi_select", options: ["a", "b"] },
        { name: "Status", type: "status", options: ["Not started", "Done"] },
        { name: "Due", type: "date" },
        { name: "Done", type: "checkbox" },
        { name: "Link", type: "url" },
        { name: "Contact", type: "email" },
        { name: "Phone", type: "phone" },
      ],
      rows: [
        {
          title: "Row 1",
          properties: {
            Summary: "Summary 1",
            Estimate: 3,
            Priority: "High",
            Tags: ["a", "b"],
            Status: "Done",
            Due: "2026-07-01",
            Done: true,
            Link: "https://example.com",
            Contact: "owner@example.com",
            Phone: "+1-555-0100",
          },
          body: [],
        },
        {
          title: "Row 2",
          properties: { Summary: "Summary 2", Estimate: 5, Priority: "Low" },
          body: [],
        },
      ],
    };

    const result = await provisionDatabase(fixture, "parent-page", { token: "secret", fetchImpl });

    const databaseCreate = requests.find((request) => request.method === "POST" && request.url.endsWith("/v1/databases"));
    const rowCreates = requests.filter((request) => request.method === "POST" && request.url.endsWith("/v1/pages"));

    expect(result).toEqual({ databaseId: "database-1", dataSourceId: "ds-1" });
    const expectedProperties = {
      Name: { title: {} },
      Summary: { rich_text: {} },
      Estimate: { number: {} },
      Priority: { select: { options: [{ name: "Low" }, { name: "High" }] } },
      Tags: { multi_select: { options: [{ name: "a" }, { name: "b" }] } },
      Status: { status: {} },
      Due: { date: {} },
      Done: { checkbox: {} },
      Link: { url: {} },
      Contact: { email: {} },
      Phone: { phone_number: {} },
    };
    expect(databaseCreate?.body.initial_data_source.properties).toMatchObject(expectedProperties);
    expect(databaseCreate?.body.properties).toMatchObject(expectedProperties);
    expect(rowCreates).toHaveLength(2);
    expect(rowCreates[0]?.body.parent).toEqual({ type: "data_source_id", data_source_id: "ds-1" });
    expect(rowCreates[1]?.body.parent).toEqual({ type: "data_source_id", data_source_id: "ds-1" });
    expect(rowCreates[0]?.body.properties).toEqual({
      Name: { title: [{ type: "text", text: { content: "Row 1" } }] },
      Summary: { rich_text: [{ type: "text", text: { content: "Summary 1" } }] },
      Estimate: { number: 3 },
      Priority: { select: { name: "High" } },
      Tags: { multi_select: [{ name: "a" }, { name: "b" }] },
      Status: { status: { name: "Done" } },
      Due: { date: { start: "2026-07-01" } },
      Done: { checkbox: true },
      Link: { url: "https://example.com" },
      Contact: { email: "owner@example.com" },
      Phone: { phone_number: "+1-555-0100" },
    });
  });
});

function fakeFetch(requests: RecordedRequest[]): typeof fetch {
  let pageCount = 0;
  let databaseCount = 0;
  let blockCount = 0;

  return vi.fn(async (url, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const urlString = String(url);
    requests.push({ url: urlString, method, body });

    if (method === "POST" && urlString.endsWith("/v1/pages")) {
      pageCount += 1;
      return jsonResponse({ id: `page-${pageCount}` });
    }

    if (method === "POST" && urlString.endsWith("/v1/databases")) {
      databaseCount += 1;
      return jsonResponse({ id: `database-${databaseCount}`, data_sources: [{ id: "ds-1", name: "Default" }] });
    }

    if (method === "GET" && urlString.includes("/children")) {
      return jsonResponse({ results: makeCreatedBlocks(100, () => `listed-block-${++blockCount}`) });
    }

    if (method === "PATCH" && urlString.includes("/children")) {
      return jsonResponse({
        results: makeCreatedBlocks(body.children.length, () => `appended-block-${++blockCount}`),
      });
    }

    return jsonResponse({ id: "ok" });
  }) as unknown as typeof fetch;
}

function makeCreatedBlocks(count: number, id: () => string) {
  return Array.from({ length: count }, () => ({ id: id() }));
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  } as Response;
}
