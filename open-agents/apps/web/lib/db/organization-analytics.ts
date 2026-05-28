import { and, inArray, isNotNull, sql } from "drizzle-orm";
import type { UsageDateRange } from "@/lib/usage/date-range";
import type { UsageRepositoryInsight } from "@/lib/usage/types";
import { db } from "./client";
import { sessions, users } from "./schema";

export interface OrganizationRepositoryEditsOptions {
  days?: number;
  range?: UsageDateRange;
  userIds?: string[];
}

function buildOrganizationRepositoryWhereClause(
  domain: string,
  options?: OrganizationRepositoryEditsOptions,
) {
  const conditions = [
    sql`${users.email} is not null`,
    sql`lower(split_part(${users.email}, '@', 2)) = ${domain}`,
    isNotNull(sessions.repoOwner),
    isNotNull(sessions.repoName),
  ];

  if (options?.range) {
    conditions.push(sql`date(${sessions.updatedAt}) >= ${options.range.from}`);
    conditions.push(sql`date(${sessions.updatedAt}) <= ${options.range.to}`);
  } else {
    const days = options?.days ?? 280;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    conditions.push(sql`${sessions.updatedAt} >= ${since.toISOString()}`);
  }

  const userIds = options?.userIds?.filter(Boolean) ?? [];
  if (userIds.length > 0) {
    conditions.push(inArray(sessions.userId, userIds));
  }

  return and(...conditions);
}

export async function getOrganizationRepositoryEdits(
  domain: string,
  options?: OrganizationRepositoryEditsOptions,
): Promise<UsageRepositoryInsight[]> {
  const rows = await db
    .select({
      repoOwner: sessions.repoOwner,
      repoName: sessions.repoName,
      sessionCount: sql<number>`count(*)::int`,
      trackedPrCount: sql<number>`count(distinct ${sessions.prNumber}) filter (where ${sessions.prNumber} is not null)::int`,
      linesAdded: sql<number>`coalesce(sum(${sessions.linesAdded}), 0)::int`,
      linesRemoved: sql<number>`coalesce(sum(${sessions.linesRemoved}), 0)::int`,
      totalLinesChanged: sql<number>`coalesce(sum(${sessions.linesAdded} + ${sessions.linesRemoved}), 0)::int`,
    })
    .from(sessions)
    .innerJoin(users, sql`${sessions.userId} = ${users.id}`)
    .where(buildOrganizationRepositoryWhereClause(domain, options))
    .groupBy(sessions.repoOwner, sessions.repoName)
    .orderBy(
      sql`coalesce(sum(${sessions.linesAdded} + ${sessions.linesRemoved}), 0) desc`,
      sessions.repoOwner,
      sessions.repoName,
    )
    .limit(10);

  return rows
    .filter((row) => row.repoOwner && row.repoName)
    .map((row) => ({
      repoOwner: row.repoOwner as string,
      repoName: row.repoName as string,
      sessionCount: row.sessionCount,
      trackedPrCount: row.trackedPrCount,
      linesAdded: row.linesAdded,
      linesRemoved: row.linesRemoved,
      totalLinesChanged: row.totalLinesChanged,
    }));
}
