import type { NextRequest } from "next/server";
import { parseUsageQueryRange } from "@/app/api/usage/_lib/query-range";
import { enrichSandboxTracesWithSessionMetadata } from "@/lib/rawtree/enrich-traces";
import { getRawTreeOrganizationSandboxTraces } from "@/lib/rawtree/traces";
import { getRawTreeOrganizationUsageUsers } from "@/lib/rawtree/usage";
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
 * GET /api/tracing/organization - RawTree-backed organization session traces.
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
    const requestedUserIds = parseSelectedUserIds(req);
    const allowedUserIds = new Set(users.map((user) => user.userId));
    const selectedUserIds = requestedUserIds.filter((userId) =>
      allowedUserIds.has(userId),
    );
    const rawTraces = await getRawTreeOrganizationSandboxTraces(domain, {
      ...(rangeResult.range ? { range: rangeResult.range } : {}),
      ...(selectedUserIds.length > 0 ? { userIds: selectedUserIds } : {}),
    });
    const traces = await enrichSandboxTracesWithSessionMetadata(
      domain,
      rawTraces,
    );

    return Response.json({
      organization: {
        domain,
        selectedUserIds,
        source: "rawtree",
        traces,
        users,
      },
    });
  } catch (error) {
    console.error("Failed to load RawTree organization traces:", error);
    return Response.json(
      { error: "Failed to load organization traces" },
      { status: 500 },
    );
  }
}
