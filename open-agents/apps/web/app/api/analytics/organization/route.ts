import type { NextRequest } from "next/server";
import { parseUsageQueryRange } from "@/app/api/usage/_lib/query-range";
import {
  getRawTreeOrganizationUsageDays,
  getRawTreeOrganizationUsageUsers,
} from "@/lib/rawtree/usage";
import { enrichSandboxTracesWithSessionMetadata } from "@/lib/rawtree/enrich-traces";
import { getRawTreeOrganizationSandboxTraces } from "@/lib/rawtree/traces";
import { getOrganizationRepositoryEdits } from "@/lib/db/organization-analytics";
import { getAllowedOrganizationEmailDomain } from "@/lib/auth/allowed-email-domains";
import { getSessionFromReq } from "@/lib/session/server";

const DEFAULT_ACTIVITY_LOOKBACK_DAYS = 365;

/**
 * GET /api/analytics/organization — RawTree-backed organization usage analytics.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const domain = getAllowedOrganizationEmailDomain(session.user.email);
  if (!domain) {
    return Response.json({ organization: null });
  }

  const rangeResult = parseUsageQueryRange(req);
  if (!rangeResult.ok) {
    return rangeResult.response;
  }

  try {
    const rangeOptions = rangeResult.range
      ? { range: rangeResult.range }
      : { days: DEFAULT_ACTIVITY_LOOKBACK_DAYS };
    const [users, usage, repositories, rawSandboxTraces] = await Promise.all([
      getRawTreeOrganizationUsageUsers(domain, rangeOptions),
      getRawTreeOrganizationUsageDays(domain, rangeOptions),
      getOrganizationRepositoryEdits(domain, rangeOptions),
      getRawTreeOrganizationSandboxTraces(domain, rangeOptions),
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
