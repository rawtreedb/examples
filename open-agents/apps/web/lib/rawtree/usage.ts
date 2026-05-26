import type { DailyUsage, UsageHistoryOptions } from "@/lib/db/usage";
import type { UsageDomainLeaderboardOptions } from "@/lib/db/usage-domain-leaderboard";
import type { UsageAggregateRow } from "@/lib/usage/compute-insights";
import type { UsageDateRange } from "@/lib/usage/date-range";
import {
  insertRawTreeRows,
  isMissingRawTreeTableError,
  isRawTreeConfigured,
  queryRawTree,
  sqlIdentifier,
  sqlStringLiteral,
  type RawTreeJsonObject,
} from "./client";

export const RAWTREE_USAGE_EVENTS_TABLE = "open_agents_usage_events";

export type RawTreeUsageEvent = RawTreeJsonObject & {
  agentType: "main" | "subagent";
  avatarUrl: string | null;
  cachedInputTokens: number;
  createdAt: string;
  email: string | null;
  emailDomain: string | null;
  eventType: "usage_event";
  id: string;
  inputTokens: number;
  modelId: string | null;
  name: string | null;
  outputTokens: number;
  provider: string | null;
  source: "web";
  toolCallCount: number;
  userId: string;
  username: string | null;
};

export type RawTreeUsageUserSnapshot = {
  avatarUrl: string | null;
  email: string | null;
  name: string | null;
  username: string | null;
};

export type RawTreeUsageDomainLeaderboardQueryRow = {
  avatarUrl: string | null;
  email: string | null;
  modelId: string | null;
  name: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  userId: string;
  username: string;
};

type RawTreeUsageHistoryRow = {
  agentType: string | null;
  cachedInputTokens: number | string | null;
  date: string;
  inputTokens: number | string | null;
  messageCount: number | string | null;
  modelId: string | null;
  outputTokens: number | string | null;
  provider: string | null;
  source: string | null;
  toolCallCount: number | string | null;
};

type RawTreeUsageAggregateQueryRow = {
  largestMainTurnTokens: number | string | null;
  mainAssistantTurnCount: number | string | null;
  mainInputTokens: number | string | null;
  mainOutputTokens: number | string | null;
  totalCachedInputTokens: number | string | null;
  totalInputTokens: number | string | null;
  totalOutputTokens: number | string | null;
  totalToolCallCount: number | string | null;
};

export async function recordRawTreeUsageEvent(
  event: Omit<
    RawTreeUsageEvent,
    "avatarUrl" | "email" | "emailDomain" | "eventType" | "name" | "username"
  >,
  user: RawTreeUsageUserSnapshot | null,
): Promise<void> {
  if (!isRawTreeConfigured()) {
    return;
  }

  await insertRawTreeRows(RAWTREE_USAGE_EVENTS_TABLE, {
    ...event,
    avatarUrl: user?.avatarUrl ?? null,
    email: user?.email ?? null,
    emailDomain: getEmailDomain(user?.email),
    eventType: "usage_event",
    name: user?.name ?? null,
    username: user?.username ?? null,
  });
}

export async function getRawTreeUsageHistory(
  userId: string,
  options?: UsageHistoryOptions,
): Promise<DailyUsage[] | null> {
  if (!isRawTreeConfigured()) {
    return null;
  }

  try {
    const rows = await queryRawTree<RawTreeUsageHistoryRow>(`
      SELECT
        ${dateExpression()} AS date,
        source,
        agentType,
        provider,
        modelId,
        sum(${numberExpression("inputTokens")}) AS inputTokens,
        sum(${numberExpression("cachedInputTokens")}) AS cachedInputTokens,
        sum(${numberExpression("outputTokens")}) AS outputTokens,
        sum(if(agentType = 'main', 1, 0)) AS messageCount,
        sum(${numberExpression("toolCallCount")}) AS toolCallCount
      FROM ${usageTable()}
      WHERE ${buildUserUsageWhereClause(userId, options)}
      GROUP BY
        date,
        source,
        agentType,
        provider,
        modelId
      ORDER BY date
    `);

    return rows.map((row) => ({
      agentType: row.agentType === "subagent" ? "subagent" : "main",
      cachedInputTokens: numberValue(row.cachedInputTokens),
      date: row.date,
      inputTokens: numberValue(row.inputTokens),
      messageCount: numberValue(row.messageCount),
      modelId: row.modelId ?? null,
      outputTokens: numberValue(row.outputTokens),
      provider: row.provider ?? null,
      source: "web",
      toolCallCount: numberValue(row.toolCallCount),
    }));
  } catch (error) {
    if (isMissingRawTreeTableError(error)) {
      return null;
    }

    throw error;
  }
}

export async function getRawTreeUsageAggregate(
  userId: string,
  options?: UsageHistoryOptions,
): Promise<UsageAggregateRow | null> {
  if (!isRawTreeConfigured()) {
    return null;
  }

  try {
    const rows = await queryRawTree<RawTreeUsageAggregateQueryRow>(`
      SELECT
        sum(${numberExpression("inputTokens")}) AS totalInputTokens,
        sum(${numberExpression("cachedInputTokens")}) AS totalCachedInputTokens,
        sum(${numberExpression("outputTokens")}) AS totalOutputTokens,
        sum(${numberExpression("toolCallCount")}) AS totalToolCallCount,
        sum(if(agentType = 'main', ${numberExpression("inputTokens")}, 0)) AS mainInputTokens,
        sum(if(agentType = 'main', ${numberExpression("outputTokens")}, 0)) AS mainOutputTokens,
        sum(if(agentType = 'main', 1, 0)) AS mainAssistantTurnCount,
        max(if(agentType = 'main', ${numberExpression("inputTokens")} + ${numberExpression("outputTokens")}, 0)) AS largestMainTurnTokens
      FROM ${usageTable()}
      WHERE ${buildUserUsageWhereClause(userId, options)}
    `);

    const row = rows[0];
    if (!row) {
      return emptyUsageAggregate();
    }

    return {
      largestMainTurnTokens: numberValue(row.largestMainTurnTokens),
      mainAssistantTurnCount: numberValue(row.mainAssistantTurnCount),
      mainInputTokens: numberValue(row.mainInputTokens),
      mainOutputTokens: numberValue(row.mainOutputTokens),
      totalCachedInputTokens: numberValue(row.totalCachedInputTokens),
      totalInputTokens: numberValue(row.totalInputTokens),
      totalOutputTokens: numberValue(row.totalOutputTokens),
      totalToolCallCount: numberValue(row.totalToolCallCount),
    };
  } catch (error) {
    if (isMissingRawTreeTableError(error)) {
      return null;
    }

    throw error;
  }
}

export async function getRawTreeUsageDomainLeaderboardRows(
  domain: string,
  options?: UsageDomainLeaderboardOptions,
): Promise<RawTreeUsageDomainLeaderboardQueryRow[] | null> {
  if (!isRawTreeConfigured()) {
    return null;
  }

  try {
    const rows = await queryRawTree<RawTreeUsageDomainLeaderboardQueryRow>(`
      SELECT
        userId,
        any(email) AS email,
        coalesce(any(username), userId) AS username,
        any(name) AS name,
        any(avatarUrl) AS avatarUrl,
        modelId,
        sum(${numberExpression("inputTokens")}) AS totalInputTokens,
        sum(${numberExpression("outputTokens")}) AS totalOutputTokens
      FROM ${usageTable()}
      WHERE ${buildDomainUsageWhereClause(domain, options)}
      GROUP BY
        userId,
        modelId
    `);

    return rows.map((row) => ({
      avatarUrl: row.avatarUrl ?? null,
      email: row.email ?? null,
      modelId: row.modelId ?? null,
      name: row.name ?? null,
      totalInputTokens: numberValue(row.totalInputTokens),
      totalOutputTokens: numberValue(row.totalOutputTokens),
      userId: row.userId,
      username: row.username || row.userId,
    }));
  } catch (error) {
    if (isMissingRawTreeTableError(error)) {
      return null;
    }

    throw error;
  }
}

function buildUserUsageWhereClause(
  userId: string,
  options?: UsageHistoryOptions,
): string {
  return [`userId = ${sqlStringLiteral(userId)}`, buildDateWhereClause(options)]
    .filter(Boolean)
    .join(" AND ");
}

function buildDomainUsageWhereClause(
  domain: string,
  options?: UsageDomainLeaderboardOptions,
): string {
  return [
    `emailDomain = ${sqlStringLiteral(domain)}`,
    buildDateWhereClause(options),
  ]
    .filter(Boolean)
    .join(" AND ");
}

function buildDateWhereClause(options?: {
  days?: number;
  range?: UsageDateRange;
  allTime?: boolean;
}): string | null {
  if (options?.range) {
    return `${dateExpression()} >= ${sqlStringLiteral(options.range.from)} AND ${dateExpression()} <= ${sqlStringLiteral(options.range.to)}`;
  }

  if (options?.allTime) {
    return null;
  }

  const days = options?.days ?? 280;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  return `${dateExpression()} >= ${sqlStringLiteral(formatDateOnly(since))}`;
}

function dateExpression(): string {
  return "substring(toString(createdAt), 1, 10)";
}

function emptyUsageAggregate(): UsageAggregateRow {
  return {
    largestMainTurnTokens: 0,
    mainAssistantTurnCount: 0,
    mainInputTokens: 0,
    mainOutputTokens: 0,
    totalCachedInputTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalToolCallCount: 0,
  };
}

function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getEmailDomain(email: string | null | undefined): string | null {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  return domain || null;
}

function numberExpression(column: string): string {
  return `toFloat64OrZero(toString(${column}))`;
}

function numberValue(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function usageTable(): string {
  return sqlIdentifier(RAWTREE_USAGE_EVENTS_TABLE);
}
