import type { NextRequest } from "next/server";
import { parseUsageQueryRange } from "@/app/api/usage/_lib/query-range";
import {
  getRawTreeOrganizationUsageDays,
  getRawTreeOrganizationUsageUsers,
} from "@/lib/rawtree/usage";
import { enrichSandboxTracesWithSessionMetadata } from "@/lib/rawtree/enrich-traces";
import { getRawTreeOrganizationSandboxTraces } from "@/lib/rawtree/traces";
import { getOrganizationRepositoryEdits } from "@/lib/db/organization-analytics";
import { getSessionFromReq } from "@/lib/session/server";
import { getUsageLeaderboardDomain } from "@/lib/usage/leaderboard-domain";

const MAX_SELECTED_USERS = 50;

function parseSelectedUserIds(req: NextRequest): string[] {
  const values = req.nextUrl.searchParams
    .getAll("userId")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(values)].slice(0, MAX_SELECTED_USERS);
}

/**
 * GET /api/analytics/organization — RawTree-backed organization usage analytics.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const domain = getUsageLeaderboardDomain(session.user.email);
  if (!domain) {
    return Response.json({ organization: null });
  }

  const rangeResult = parseUsageQueryRange(req);
  if (!rangeResult.ok) {
    return rangeResult.response;
  }

  try {
    const users = await getRawTreeOrganizationUsageUsers(domain);
    const rangeOptions = rangeResult.range
      ? { range: rangeResult.range }
      : undefined;
    const allowedUserIds = new Set(users.map((user) => user.userId));
    const selectedUserIds = parseSelectedUserIds(req).filter((userId) =>
      allowedUserIds.has(userId),
    );
    const queryOptions = {
      ...rangeOptions,
      ...(selectedUserIds.length > 0 ? { userIds: selectedUserIds } : {}),
    };
    const [usage, repositories, rawSandboxTraces] = await Promise.all([
      getRawTreeOrganizationUsageDays(domain, queryOptions),
      getOrganizationRepositoryEdits(domain, queryOptions),
      getRawTreeOrganizationSandboxTraces(domain, queryOptions),
    ]);
    const sandboxTraces = await enrichSandboxTracesWithSessionMetadata(
      domain,
      rawSandboxTraces,
    );

    return Response.json({
      organization: {
        domain,
        repositories,
        sandboxTraces,
        selectedUserIds,
        source: "rawtree",
        usage,
        users,
      },
    });
  } catch (error) {
    console.error("Failed to load RawTree organization analytics:", error);
    return Response.json(
      { error: "Failed to load organization analytics" },
      { status: 500 },
    );
  }
}
