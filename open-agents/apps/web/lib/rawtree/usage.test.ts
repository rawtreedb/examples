import { beforeEach, describe, expect, mock, test } from "bun:test";

const insertRawTreeRowsMock = mock(async () => undefined);
const queryRawTreeMock = mock(async (_sql: string): Promise<unknown[]> => []);

mock.module("./client", () => ({
  insertRawTreeRows: insertRawTreeRowsMock,
  queryRawTree: queryRawTreeMock,
  sqlIdentifier: (value: string) => `\`${value}\``,
  sqlStringLiteral: (value: string) => `'${value.replaceAll("'", "''")}'`,
}));

const usageModulePromise = import("./usage");

beforeEach(() => {
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

  test("queries direct RawTree fields for usage history", async () => {
    const { getRawTreeUsageHistory } = await usageModulePromise;
    queryRawTreeMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain("FROM `open_agents_usage_events`");
      expect(sql).toContain("dynamicElement(userId, 'String') = 'user-''1'");
      expect(sql).toContain(
        "substring(dynamicElement(createdAt, 'String'), 1, 10)",
      );
      expect(sql).not.toContain("__raw_data");
      return [
        {
          agentTypeValue: "subagent",
          cachedInputTokens: "2",
          date: "2026-05-26",
          inputTokens: "10",
          messageCount: "0",
          modelIdValue: "openai/gpt-5.4-mini",
          outputTokens: "20",
          providerValue: "openai",
          sourceValue: "web",
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

  test("queries organization users from direct RawTree fields", async () => {
    const { getRawTreeOrganizationUsageUsers } = await usageModulePromise;
    queryRawTreeMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain("FROM `open_agents_usage_events`");
      expect(sql).toContain(
        "dynamicElement(emailDomain, 'String') = 'tinybird.co'",
      );
      expect(sql).toContain(
        "coalesce(any(dynamicElement(username, 'String')), userIdValue) AS usernameValue",
      );
      expect(sql).toContain(
        "sum(coalesce(dynamicElement(inputTokens, 'Float64'), toFloat64(dynamicElement(inputTokens, 'Int64')), toFloat64(dynamicElement(inputTokens, 'UInt64')), 0) + coalesce(dynamicElement(outputTokens, 'Float64'), toFloat64(dynamicElement(outputTokens, 'Int64')), toFloat64(dynamicElement(outputTokens, 'UInt64')), 0)) AS totalTokens",
      );
      expect(sql).not.toContain("__raw_data");
      return [
        {
          avatarUrlValue: null,
          lastSeenAtValue: "2026-05-26T10:00:00.000Z",
          messageCount: "2",
          nameValue: "Rafa",
          totalTokens: "30",
          userIdValue: "user-1",
          usernameValue: null,
        },
      ];
    });

    const rows = await getRawTreeOrganizationUsageUsers("tinybird.co");

    expect(rows).toEqual([
      {
        avatarUrl: null,
        lastSeenAt: "2026-05-26T10:00:00.000Z",
        messageCount: 2,
        name: "Rafa",
        totalTokens: 30,
        userId: "user-1",
        username: "user-1",
      },
    ]);
  });

  test("queries organization usage days with optional user filters", async () => {
    const { getRawTreeOrganizationUsageDays } = await usageModulePromise;
    queryRawTreeMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain("FROM `open_agents_usage_events`");
      expect(sql).toContain(
        "dynamicElement(emailDomain, 'String') = 'tinybird.co'",
      );
      expect(sql).toContain(
        "substring(dynamicElement(createdAt, 'String'), 1, 10) >= '2026-05-01'",
      );
      expect(sql).toContain(
        "substring(dynamicElement(createdAt, 'String'), 1, 10) <= '2026-05-31'",
      );
      expect(sql).toContain(
        "dynamicElement(userId, 'String') IN ('user-1', 'user-''2')",
      );
      expect(sql).toContain(
        "sum(coalesce(dynamicElement(toolCallCount, 'Float64'), toFloat64(dynamicElement(toolCallCount, 'Int64')), toFloat64(dynamicElement(toolCallCount, 'UInt64')), 0)) AS toolCallCount",
      );
      expect(sql).not.toContain("__raw_data");
      return [
        {
          cachedInputTokens: "1",
          date: "2026-05-26",
          inputTokens: "10",
          messageCount: "3",
          outputTokens: "20",
          toolCallCount: "4",
        },
      ];
    });

    const rows = await getRawTreeOrganizationUsageDays("tinybird.co", {
      range: { from: "2026-05-01", to: "2026-05-31" },
      userIds: ["user-1", "user-'2", "user-1", ""],
    });

    expect(rows).toEqual([
      {
        cachedInputTokens: 1,
        date: "2026-05-26",
        inputTokens: 10,
        messageCount: 3,
        outputTokens: 20,
        toolCallCount: 4,
      },
    ]);
  });

  test("throws when RawTree usage history cannot be queried", async () => {
    const { getRawTreeUsageHistory } = await usageModulePromise;
    const queryError = new Error("RawTree table is missing");
    queryRawTreeMock.mockImplementationOnce(async () => {
      throw queryError;
    });

    await expect(getRawTreeUsageHistory("user-1")).rejects.toThrow(queryError);
  });

  test("throws for organization analytics when RawTree cannot be queried", async () => {
    const {
      getRawTreeOrganizationUsageDays,
      getRawTreeOrganizationUsageUsers,
    } = await usageModulePromise;
    const usersError = new Error("RawTree users query failed");
    const daysError = new Error("RawTree days query failed");
    queryRawTreeMock.mockImplementationOnce(async () => {
      throw usersError;
    });
    queryRawTreeMock.mockImplementationOnce(async () => {
      throw daysError;
    });

    await expect(
      getRawTreeOrganizationUsageUsers("tinybird.co"),
    ).rejects.toThrow(usersError);
    await expect(
      getRawTreeOrganizationUsageDays("tinybird.co"),
    ).rejects.toThrow(daysError);
  });
});
