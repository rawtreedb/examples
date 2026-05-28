import { and, eq, sql } from "drizzle-orm";
import {
  buildUsageInsights,
  type UsageSessionInsightRow,
} from "@/lib/usage/compute-insights";
import {
  getDateRangeDaysInclusive,
  type UsageDateRange,
} from "@/lib/usage/date-range";
import { getRawTreeUsageAggregate } from "@/lib/rawtree/usage";
import type { UsageInsights } from "@/lib/usage/types";
import { db } from "./client";
import { sessions } from "./schema";

export interface UsageInsightsOptions {
  days?: number;
  range?: UsageDateRange;
  allTime?: boolean;
}

function buildSessionsWhereClause(
  userId: string,
  options?: UsageInsightsOptions,
) {
  if (options?.range) {
    return and(
      eq(sessions.userId, userId),
      sql`date(${sessions.updatedAt}) >= ${options.range.from}`,
      sql`date(${sessions.updatedAt}) <= ${options.range.to}`,
    );
  }

  if (options?.allTime) {
    return eq(sessions.userId, userId);
  }

  const days = options?.days ?? 280;
  const since = new Date();
  since.setDate(since.getDate() - days);

  return and(
    eq(sessions.userId, userId),
    sql`${sessions.updatedAt} >= ${since.toISOString()}`,
  );
}

function getLookbackDays(options?: UsageInsightsOptions): number {
  if (options?.range) {
    return getDateRangeDaysInclusive(options.range);
  }

  if (options?.allTime) {
    return 0;
  }

  return options?.days ?? 280;
}

export async function getUsageInsights(
  userId: string,
  options?: UsageInsightsOptions,
): Promise<UsageInsights> {
  const [aggregate, sessionRows] = await Promise.all([
    getRawTreeUsageAggregate(userId, options),
    db
      .select({
        repoOwner: sessions.repoOwner,
        repoName: sessions.repoName,
        prNumber: sessions.prNumber,
        prStatus: sessions.prStatus,
        linesAdded: sessions.linesAdded,
        linesRemoved: sessions.linesRemoved,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .where(buildSessionsWhereClause(userId, options)),
  ]);

  return buildUsageInsights({
    lookbackDays: getLookbackDays(options),
    aggregate,
    sessions: sessionRows as UsageSessionInsightRow[],
  });
}
