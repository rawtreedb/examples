import type { DailyUsage, UsageHistoryOptions } from "@/lib/db/usage";
import type { UsageDomainLeaderboardOptions } from "@/lib/db/usage-domain-leaderboard";
import type { UsageAggregateRow } from "@/lib/usage/compute-insights";
import type { UsageDateRange } from "@/lib/usage/date-range";
import {
  insertRawTreeRows,
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
  agentTypeValue: string | null;
  cachedInputTokens: number | string | null;
  date: string;
  inputTokens: number | string | null;
  messageCount: number | string | null;
  modelIdValue: string | null;
  outputTokens: number | string | null;
  providerValue: string | null;
  sourceValue: string | null;
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

type RawTreeUsageDomainLeaderboardRawRow = {
  avatarUrlValue: string | null;
  emailValue: string | null;
  modelIdValue: string | null;
  nameValue: string | null;
  totalInputTokens: number | string | null;
  totalOutputTokens: number | string | null;
  userIdValue: string;
  usernameValue: string | null;
};

type RawTreeOrganizationUsageDayRow = {
  cachedInputTokens: number | string | null;
  date: string;
  inputTokens: number | string | null;
  messageCount: number | string | null;
  outputTokens: number | string | null;
  toolCallCount: number | string | null;
};

type RawTreeOrganizationUsageUserRow = {
  avatarUrlValue: string | null;
  lastSeenAtValue: string | null;
  messageCount: number | string | null;
  nameValue: string | null;
  totalTokens: number | string | null;
  userIdValue: string;
  usernameValue: string | null;
};

export type RawTreeOrganizationUsageDay = {
  cachedInputTokens: number;
  date: string;
  inputTokens: number;
  messageCount: number;
  outputTokens: number;
  toolCallCount: number;
};

export type RawTreeOrganizationUsageUser = {
  avatarUrl: string | null;
  lastSeenAt: string | null;
  messageCount: number;
  name: string | null;
  totalTokens: number;
  userId: string;
  username: string;
};

export interface RawTreeOrganizationUsageOptions {
  range?: UsageDateRange;
  userIds?: string[];
}

export async function recordRawTreeUsageEvent(
  event: Omit<
    RawTreeUsageEvent,
    "avatarUrl" | "email" | "emailDomain" | "eventType" | "name" | "username"
  >,
  user: RawTreeUsageUserSnapshot | null,
): Promise<void> {
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

export async function getRawTreeOrganizationUsageUsers(
  domain: string,
): Promise<RawTreeOrganizationUsageUser[]> {
  const rows = await queryRawTree<RawTreeOrganizationUsageUserRow>(`
      SELECT
        ${stringExpression("userId")} AS userIdValue,
        coalesce(any(${stringExpression("username")}), userIdValue) AS usernameValue,
        any(${stringExpression("name")}) AS nameValue,
        any(${stringExpression("avatarUrl")}) AS avatarUrlValue,
        max(${stringExpression("createdAt")}) AS lastSeenAtValue,
        sum(${numberExpression("inputTokens")} + ${numberExpression("outputTokens")}) AS totalTokens,
        sum(if(${stringExpression("agentType")} = 'main', 1, 0)) AS messageCount
      FROM ${usageTable()}
      WHERE ${buildDomainUsageWhereClause(domain)}
      GROUP BY userIdValue
      ORDER BY totalTokens DESC, usernameValue ASC
    `);

  return rows.map((row) => ({
    avatarUrl: row.avatarUrlValue ?? null,
    lastSeenAt: row.lastSeenAtValue ?? null,
    messageCount: numberValue(row.messageCount),
    name: row.nameValue ?? null,
    totalTokens: numberValue(row.totalTokens),
    userId: row.userIdValue,
    username: row.usernameValue || row.userIdValue,
  }));
}

export async function getRawTreeOrganizationUsageDays(
  domain: string,
  options?: RawTreeOrganizationUsageOptions,
): Promise<RawTreeOrganizationUsageDay[]> {
  const rows = await queryRawTree<RawTreeOrganizationUsageDayRow>(`
      SELECT
        ${dateExpression()} AS date,
        sum(${numberExpression("inputTokens")}) AS inputTokens,
        sum(${numberExpression("cachedInputTokens")}) AS cachedInputTokens,
        sum(${numberExpression("outputTokens")}) AS outputTokens,
        sum(if(${stringExpression("agentType")} = 'main', 1, 0)) AS messageCount,
        sum(${numberExpression("toolCallCount")}) AS toolCallCount
      FROM ${usageTable()}
      WHERE ${buildOrganizationUsageWhereClause(domain, options)}
      GROUP BY date
      ORDER BY date
    `);

  return rows.map((row) => ({
    cachedInputTokens: numberValue(row.cachedInputTokens),
    date: row.date,
    inputTokens: numberValue(row.inputTokens),
    messageCount: numberValue(row.messageCount),
    outputTokens: numberValue(row.outputTokens),
    toolCallCount: numberValue(row.toolCallCount),
  }));
}

export async function getRawTreeUsageHistory(
  userId: string,
  options?: UsageHistoryOptions,
): Promise<DailyUsage[]> {
  const rows = await queryRawTree<RawTreeUsageHistoryRow>(`
      SELECT
        ${dateExpression()} AS date,
        ${stringExpression("source")} AS sourceValue,
        ${stringExpression("agentType")} AS agentTypeValue,
        ${stringExpression("provider")} AS providerValue,
        ${stringExpression("modelId")} AS modelIdValue,
        sum(${numberExpression("inputTokens")}) AS inputTokens,
        sum(${numberExpression("cachedInputTokens")}) AS cachedInputTokens,
        sum(${numberExpression("outputTokens")}) AS outputTokens,
        sum(if(agentTypeValue = 'main', 1, 0)) AS messageCount,
        sum(${numberExpression("toolCallCount")}) AS toolCallCount
      FROM ${usageTable()}
      WHERE ${buildUserUsageWhereClause(userId, options)}
      GROUP BY
        date,
        sourceValue,
        agentTypeValue,
        providerValue,
        modelIdValue
      ORDER BY date
    `);

  return rows.map((row) => ({
    agentType: row.agentTypeValue === "subagent" ? "subagent" : "main",
    cachedInputTokens: numberValue(row.cachedInputTokens),
    date: row.date,
    inputTokens: numberValue(row.inputTokens),
    messageCount: numberValue(row.messageCount),
    modelId: row.modelIdValue ?? null,
    outputTokens: numberValue(row.outputTokens),
    provider: row.providerValue ?? null,
    source: "web",
    toolCallCount: numberValue(row.toolCallCount),
  }));
}

export async function getRawTreeUsageAggregate(
  userId: string,
  options?: UsageHistoryOptions,
): Promise<UsageAggregateRow> {
  const rows = await queryRawTree<RawTreeUsageAggregateQueryRow>(`
      SELECT
        sum(${numberExpression("inputTokens")}) AS totalInputTokens,
        sum(${numberExpression("cachedInputTokens")}) AS totalCachedInputTokens,
        sum(${numberExpression("outputTokens")}) AS totalOutputTokens,
        sum(${numberExpression("toolCallCount")}) AS totalToolCallCount,
        sum(if(${stringExpression("agentType")} = 'main', ${numberExpression("inputTokens")}, 0)) AS mainInputTokens,
        sum(if(${stringExpression("agentType")} = 'main', ${numberExpression("outputTokens")}, 0)) AS mainOutputTokens,
        sum(if(${stringExpression("agentType")} = 'main', 1, 0)) AS mainAssistantTurnCount,
        max(if(${stringExpression("agentType")} = 'main', ${numberExpression("inputTokens")} + ${numberExpression("outputTokens")}, 0)) AS largestMainTurnTokens
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
}

export async function getRawTreeUsageDomainLeaderboardRows(
  domain: string,
  options?: UsageDomainLeaderboardOptions,
): Promise<RawTreeUsageDomainLeaderboardQueryRow[]> {
  const rows = await queryRawTree<RawTreeUsageDomainLeaderboardRawRow>(`
      SELECT
        ${stringExpression("userId")} AS userIdValue,
        any(${stringExpression("email")}) AS emailValue,
        coalesce(any(${stringExpression("username")}), userIdValue) AS usernameValue,
        any(${stringExpression("name")}) AS nameValue,
        any(${stringExpression("avatarUrl")}) AS avatarUrlValue,
        ${stringExpression("modelId")} AS modelIdValue,
        sum(${numberExpression("inputTokens")}) AS totalInputTokens,
        sum(${numberExpression("outputTokens")}) AS totalOutputTokens
      FROM ${usageTable()}
      WHERE ${buildDomainUsageWhereClause(domain, options)}
      GROUP BY
        userIdValue,
        modelIdValue
    `);

  return rows.map((row) => ({
    avatarUrl: row.avatarUrlValue ?? null,
    email: row.emailValue ?? null,
    modelId: row.modelIdValue ?? null,
    name: row.nameValue ?? null,
    totalInputTokens: numberValue(row.totalInputTokens),
    totalOutputTokens: numberValue(row.totalOutputTokens),
    userId: row.userIdValue,
    username: row.usernameValue || row.userIdValue,
  }));
}

function buildUserUsageWhereClause(
  userId: string,
  options?: UsageHistoryOptions,
): string {
  return [
    `${stringExpression("userId")} = ${sqlStringLiteral(userId)}`,
    buildDateWhereClause(options),
  ]
    .filter(Boolean)
    .join(" AND ");
}

function buildDomainUsageWhereClause(
  domain: string,
  options?: UsageDomainLeaderboardOptions,
): string {
  return [
    `${stringExpression("emailDomain")} = ${sqlStringLiteral(domain)}`,
    buildDateWhereClause(options),
  ]
    .filter(Boolean)
    .join(" AND ");
}

function buildOrganizationUsageWhereClause(
  domain: string,
  options?: RawTreeOrganizationUsageOptions,
): string {
  return [
    buildDomainUsageWhereClause(domain, options),
    buildUserIdsWhereClause(options?.userIds),
  ]
    .filter(Boolean)
    .join(" AND ");
}

function buildUserIdsWhereClause(userIds: string[] | undefined): string | null {
  const values = userIds ? [...new Set(userIds)].filter(Boolean) : [];
  if (values.length === 0) {
    return null;
  }

  return `${stringExpression("userId")} IN (${values.map((userId) => sqlStringLiteral(userId)).join(", ")})`;
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
  return `substring(${stringExpression("createdAt")}, 1, 10)`;
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
  return `coalesce(dynamicElement(${column}, 'Float64'), toFloat64(dynamicElement(${column}, 'Int64')), toFloat64(dynamicElement(${column}, 'UInt64')), 0)`;
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

function stringExpression(column: string): string {
  return `dynamicElement(${column}, 'String')`;
}
