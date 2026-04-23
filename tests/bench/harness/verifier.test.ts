import type { GroundTruth, TranscriptData } from "./types.ts";

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

function makeSdkContext(users: Array<{ id: string; type: string; name?: string }>) {
  return {
    listUsers: vi.fn().mockResolvedValue(users),
  };
}

describe("bench harness verifier", () => {
  describe("users.must_include_bot", () => {
    it("passes when the SDK user list contains a bot", async () => {
      const { verifyGroundTruth } = await importVerifier();
      const groundTruth: GroundTruth = {
        users: [{ must_include_bot: true }],
      };

      const result = await verifyGroundTruth(
        groundTruth,
        makeTranscript(),
        makeSdkContext([
          { id: "user_1", type: "person", name: "Alice" },
          { id: "user_2", type: "bot", name: "Test Bot" },
        ]),
      );

      expect(result.passed).toBe(true);
      expect(result.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            passed: true,
            claim: expect.stringContaining("users"),
          }),
        ]),
      );
    });

    it("fails with a descriptive message when no bot is present", async () => {
      const { verifyGroundTruth } = await importVerifier();
      const groundTruth: GroundTruth = {
        users: [{ must_include_bot: true }],
      };

      const result = await verifyGroundTruth(
        groundTruth,
        makeTranscript(),
        makeSdkContext([
          { id: "user_1", type: "person", name: "Alice" },
          { id: "user_2", type: "person", name: "Bob" },
        ]),
      );

      expect(result.passed).toBe(false);
      expect(result.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            passed: false,
            claim: expect.stringContaining("users"),
            message: expect.stringMatching(/bot/i),
          }),
        ]),
      );
    });

    it("fails when size_min is not met", async () => {
      const { verifyGroundTruth } = await importVerifier();
      const groundTruth: GroundTruth = {
        users: [{ size_min: 2 }],
      };

      const result = await verifyGroundTruth(
        groundTruth,
        makeTranscript(),
        makeSdkContext([{ id: "user_1", type: "bot", name: "Test Bot" }]),
      );

      expect(result.passed).toBe(false);
      expect(result.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            passed: false,
            message: expect.stringMatching(/size|min|2/i),
          }),
        ]),
      );
    });
  });

  describe("tools_must_be_called", () => {
    it("passes when a required tool suffix appears in the transcript", async () => {
      const { verifyGroundTruth } = await importVerifier();
      const groundTruth: GroundTruth = {
        tools_must_be_called: ["get_me"],
      };

      const result = await verifyGroundTruth(
        groundTruth,
        makeTranscript({
          toolUses: [
            {
              id: "toolu_1",
              name: "mcp__easy-notion__get_me",
              input: {},
            },
          ],
        }),
        makeSdkContext([]),
      );

      expect(result.passed).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("soft-fails with a warning when no required tool was called", async () => {
      const { verifyGroundTruth } = await importVerifier();
      const groundTruth: GroundTruth = {
        tools_must_be_called: ["get_me"],
      };

      const result = await verifyGroundTruth(groundTruth, makeTranscript(), makeSdkContext([]));

      expect(result.passed).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/get_me/i)]),
      );
      expect(result.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            passed: true,
            warnings: expect.arrayContaining([expect.stringMatching(/get_me/i)]),
          }),
        ]),
      );
    });

    it("warns about any missing tools when only a subset was called", async () => {
      const { verifyGroundTruth } = await importVerifier();
      const groundTruth: GroundTruth = {
        tools_must_be_called: ["get_me", "list_users"],
      };

      const result = await verifyGroundTruth(
        groundTruth,
        makeTranscript({
          toolUses: [
            {
              id: "toolu_1",
              name: "mcp__easy-notion__get_me",
              input: {},
            },
          ],
        }),
        makeSdkContext([]),
      );

      expect(result.passed).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/list_users/i)]),
      );
    });
  });
});
