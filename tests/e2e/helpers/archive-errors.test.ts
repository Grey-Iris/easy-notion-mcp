import { describe, expect, it } from "vitest";

import { classifyArchiveError } from "./archive-errors.js";

describe("classifyArchiveError", () => {
  const id = "page-123";

  it("classifies already_archived from the enhanced validation_error message", () => {
    const raw =
      "Can't edit block that is archived. You must unarchive the block before editing. Check property names and types with get_database.";

    expect(classifyArchiveError(id, raw)).toEqual({
      class: "already_archived",
      id,
      raw,
    });
  });

  it("classifies archived_ancestor from the enhanced validation_error message", () => {
    const raw =
      "Can't edit page on block with an archived ancestor. Check property names and types with get_database.";

    expect(classifyArchiveError(id, raw)).toEqual({
      class: "archived_ancestor",
      id,
      raw,
    });
  });

  it("classifies not_found from the enhanced object_not_found message", () => {
    const raw =
      'Could not find page with ID: deadbeef-dead-beef-dead-beefdeadbeef. Make sure the relevant pages and databases are shared with your integration "Iris". Make sure the page/database is shared with your Notion integration.';

    expect(classifyArchiveError(id, raw)).toEqual({
      class: "not_found",
      id,
      raw,
    });
  });

  it("falls through MCP request timeout errors to unexpected", () => {
    const raw = "MCP request timeout: archive_page";

    expect(classifyArchiveError(id, raw)).toEqual({
      class: "unexpected",
      id,
      raw,
    });
  });

  it("falls through empty strings to unexpected", () => {
    const raw = "";

    expect(classifyArchiveError(id, raw)).toEqual({
      class: "unexpected",
      id,
      raw,
    });
  });

  it("falls through unrelated validation failures to unexpected", () => {
    const raw =
      "body failed validation: rich_text[0].text.content.length should be ≤ 2000";

    expect(classifyArchiveError(id, raw)).toEqual({
      class: "unexpected",
      id,
      raw,
    });
  });

  it("prefers archived_ancestor when both archived substrings are present", () => {
    const raw =
      "Can't edit page on block with an archived ancestor. Can't edit block that is archived. Check property names and types with get_database.";

    expect(classifyArchiveError(id, raw)).toEqual({
      class: "archived_ancestor",
      id,
      raw,
    });
  });
});
