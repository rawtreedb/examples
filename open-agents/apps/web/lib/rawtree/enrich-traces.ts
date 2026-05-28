import { getSessionTraceMetadataByIds } from "@/lib/db/sessions";
import type { RawTreeSandboxTraceSummary } from "./traces";

const SESSION_SANDBOX_PREFIX = "session_";

function getAppSessionIdFromSandboxName(
  sandboxName: string | null,
): string | null {
  if (!sandboxName?.startsWith(SESSION_SANDBOX_PREFIX)) {
    return null;
  }

  return sandboxName.slice(SESSION_SANDBOX_PREFIX.length) || null;
}

function getTraceSessionIdCandidates(
  trace: RawTreeSandboxTraceSummary,
): string[] {
  const candidates: string[] = [];
  if (trace.sessionId) {
    candidates.push(trace.sessionId);
  }

  const appSessionId = getAppSessionIdFromSandboxName(trace.sandboxName);
  if (appSessionId) {
    candidates.push(appSessionId);
  }

  return candidates;
}

export async function enrichSandboxTracesWithSessionMetadata(
  domain: string,
  traces: RawTreeSandboxTraceSummary[],
): Promise<RawTreeSandboxTraceSummary[]> {
  const metadataBySessionId = await getSessionTraceMetadataByIds(
    traces.flatMap(getTraceSessionIdCandidates),
    domain,
  );

  return traces.map((trace) => {
    const metadata = getTraceSessionIdCandidates(trace)
      .map((candidate) => metadataBySessionId.get(candidate))
      .find(Boolean);

    return {
      ...trace,
      repoName: metadata?.repoName ?? trace.repoName,
      repoOwner: metadata?.repoOwner ?? trace.repoOwner,
      sessionId: metadata?.id ?? trace.sessionId,
      sessionTitle: metadata?.title ?? trace.sessionTitle,
      startedAt: trace.startedAt ?? metadata?.createdAt.toISOString() ?? null,
    };
  });
}
