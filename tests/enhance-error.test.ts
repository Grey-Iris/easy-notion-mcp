import { describe, expect, it } from "vitest";
import { enhanceError } from "../src/server.js";

function validationError(message: string): Error & { body: { code: string } } {
  const error = new Error(message) as Error & { body: { code: string } };
  error.body = { code: "validation_error" };
  return error;
}

describe("enhanceError", () => {
  it("keeps the get_database hint for property-related validation errors", () => {
    const message = enhanceError(
      validationError("Stage is not a property that exists"),
      "update_database_entry",
      {},
    );

    expect(message).toContain("Stage is not a property that exists");
    expect(message).toContain("get_database");
  });

  it("does not add the get_database hint for non-property validation errors", () => {
    const message = enhanceError(
      validationError('path.0.id should be a valid uuid, instead was "abc".'),
      "find_replace",
      {},
    );

    expect(message).not.toContain("get_database");
  });
});
