import { beforeEach, describe, expect, mock, test } from "bun:test";

const missingTableError = new Error("RawTree table is missing");
const insertRawTreeRowsMock = mock(async () => undefined);
const queryRawTreeMock = mock(async (_sql: string): Promise<unknown[]> => []);
let rawTreeConfigured = true;

mock.module("./client", () => ({
  insertRawTreeRows: insertRawTreeRowsMock,
  isMissingRawTreeTableError: (error: unknown) => error === missingTableError,
  isRawTreeConfigured: () => rawTreeConfigured,
  queryRawTree: queryRawTreeMock,
  sqlIdentifier: (value: string) => `\`${value}\``,
  sqlStringLiteral: (value: string) => `'${value.replaceAll("'", "''")}'`,
}));

const usageModulePromise = import("./usage");

beforeEach(() => {
  rawTreeConfigured = true;
  insertRawTreeRowsMock.mockClear();
  queryRawTreeMock.mockClear();
  insertRawTreeRowsMock.mockImplementation(async () => undefined);
  queryRawTreeMock.mockImplementation(async () => []);
});

describe("RawTree usage storage", () => {
  test("records denormalized usage events", async () => {
    const { RAWTREE_USAGE_EVENTS_TABLE, recordRawTreeUsageEvent } =
      await usageModulePromise;

    await recordRawTreeUsageEvent(
      {
        agentType: "main",
        cachedInputTokens: 2,
        createdAt: "2026-05-26T10:00:00.000Z",
        id: "usage-1",
        inputTokens: 10,
        modelId: "openai/gpt-5.4-mini",
        outputTokens: 20,
        provider: "openai",
        source: "web",
        toolCallCount: 3,
        userId: "user-1",
      },
      {
        avatarUrl: "https://example.com/avatar.png",
        email: "Rafa@RawTree.com",
        name: "Rafa",
        username: "rafa",
      },
    );

    expect(insertRawTreeRowsMock).toHaveBeenCalledWith(
      RAWTREE_USAGE_EVENTS_TABLE,
      {
        agentType: "main",
        avatarUrl: "https://example.com/avatar.png",
        cachedInputTokens: 2,
        createdAt: "2026-05-26T10:00:00.000Z",
        email: "Rafa@RawTree.com",
        emailDomain: "rawtree.com",
        eventType: "usage_event",
        id: "usage-1",
        inputTokens: 10,
        modelId: "openai/gpt-5.4-mini",
        name: "Rafa",
        outputTokens: 20,
        provider: "openai",
        source: "web",
        toolCallCount: 3,
        userId: "user-1",
        username: "rafa",
      },
    );
  });

  test("does not write when RawTree is not configured", async () => {
    const { recordRawTreeUsageEvent } = await usageModulePromise;
    rawTreeConfigured = false;

    await recordRawTreeUsageEvent(
      {
        agentType: "main",
        cachedInputTokens: 0,
        createdAt: "2026-05-26T10:00:00.000Z",
        id: "usage-1",
        inputTokens: 1,
        modelId: null,
        outputTokens: 1,
        provider: null,
        source: "web",
        toolCallCount: 0,
        userId: "user-1",
      },
      null,
    );

    expect(insertRawTreeRowsMock).not.toHaveBeenCalled();
  });

  test("queries direct RawTree fields for usage history", async () => {
    const { getRawTreeUsageHistory } = await usageModulePromise;
    queryRawTreeMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain("FROM `open_agents_usage_events`");
      expect(sql).toContain("userId = 'user-''1'");
      expect(sql).toContain("substring(toString(createdAt), 1, 10)");
      expect(sql).not.toContain("__raw_data");
      return [
        {
          agentType: "subagent",
          cachedInputTokens: "2",
          date: "2026-05-26",
          inputTokens: "10",
          messageCount: "0",
          modelId: "openai/gpt-5.4-mini",
          outputTokens: "20",
          provider: "openai",
          source: "web",
          toolCallCount: "3",
        },
      ];
    });

    const rows = await getRawTreeUsageHistory("user-'1", {
      range: { from: "2026-05-01", to: "2026-05-31" },
    });

    expect(rows).toEqual([
      {
        agentType: "subagent",
        cachedInputTokens: 2,
        date: "2026-05-26",
        inputTokens: 10,
        messageCount: 0,
        modelId: "openai/gpt-5.4-mini",
        outputTokens: 20,
        provider: "openai",
        source: "web",
        toolCallCount: 3,
      },
    ]);
  });

  test("returns null when the RawTree table has not been created", async () => {
    const { getRawTreeUsageHistory } = await usageModulePromise;
    queryRawTreeMock.mockImplementationOnce(async () => {
      throw missingTableError;
    });

    await expect(getRawTreeUsageHistory("user-1")).resolves.toBeNull();
  });
});
