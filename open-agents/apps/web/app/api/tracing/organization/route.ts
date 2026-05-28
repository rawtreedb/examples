import type { NextRequest } from "next/server";
import { parseUsageQueryRange } from "@/app/api/usage/_lib/query-range";
import {
  enrichSandboxTracesWithSessionMetadata,
  summarizeSandboxTracesBySession,
} from "@/lib/rawtree/enrich-traces";
import { getRawTreeOrganizationSandboxTraces } from "@/lib/rawtree/traces";
import { getAllowedOrganizationEmailDomain } from "@/lib/auth/allowed-email-domains";
import { getSessionFromReq } from "@/lib/session/server";

/**
 * GET /api/tracing/organization - RawTree-backed organization session traces.
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
    const rawTraces = await getRawTreeOrganizationSandboxTraces(domain, {
      ...(rangeResult.range ? { range: rangeResult.range } : {}),
      includeSessionProductTraces: true,
      limit: 500,
    });
    const traces = summarizeSandboxTracesBySession(
      await enrichSandboxTracesWithSessionMetadata(domain, rawTraces),
      100,
    );

    return Response.json({
      organization: {
        domain,
        source: "rawtree",
        traces,
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
