import { expect } from "vitest";

export function assertNoWarnings(response: { warnings?: unknown }): void {
  expect(response.warnings).toBeUndefined();
}

export function expectWarnings(
  response: any,
  expected: Array<{ code: string }>,
): void {
  expect(response.warnings).toEqual(
    expect.arrayContaining(
      expected.map((warning) => expect.objectContaining(warning)),
    ),
  );
}
