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

  return traces.flatMap((trace) => {
    const metadata = getTraceSessionIdCandidates(trace)
      .map((candidate) => metadataBySessionId.get(candidate))
      .find(Boolean);

    if (!metadata && !trace.matchedOrganizationDomain) {
      return [];
    }

    return {
      ...trace,
      repoName: metadata?.repoName ?? trace.repoName,
      repoOwner: metadata?.repoOwner ?? trace.repoOwner,
      sessionId: metadata?.id ?? trace.sessionId,
      sessionTitle: metadata?.title ?? trace.sessionTitle,
      startedAt: trace.startedAt ?? metadata?.createdAt.toISOString() ?? null,
      userId: metadata?.userId ?? trace.userId,
      username: metadata?.username ?? trace.username,
    };
  });
}

export function summarizeSandboxTracesBySession(
  traces: RawTreeSandboxTraceSummary[],
  limit = 20,
): RawTreeSandboxTraceSummary[] {
  const summariesBySession = new Map<string, RawTreeSandboxTraceSummary>();

  for (const trace of traces) {
    const key = getTraceSessionGroupKey(trace);
    const existing = summariesBySession.get(key);
    if (!existing) {
      summariesBySession.set(key, { ...trace });
      continue;
    }

    summariesBySession.set(key, mergeSessionTraceSummary(existing, trace));
  }

  return [...summariesBySession.values()]
    .sort((left, right) =>
      (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? ""),
    )
    .slice(0, limit);
}

function getTraceSessionGroupKey(trace: RawTreeSandboxTraceSummary): string {
  if (trace.sessionId) {
    return `session:${trace.sessionId}`;
  }

  if (trace.sandboxName) {
    return `sandbox:${trace.sandboxName}`;
  }

  return `trace:${trace.traceId}`;
}

function mergeSessionTraceSummary(
  left: RawTreeSandboxTraceSummary,
  right: RawTreeSandboxTraceSummary,
): RawTreeSandboxTraceSummary {
  const startedAt = minIso(left.startedAt, right.startedAt);
  const lastSeenAt = maxIso(left.lastSeenAt, right.lastSeenAt);
  const latestTrace =
    compareIso(right.lastSeenAt, left.lastSeenAt) > 0 ? right : left;

  return {
    ...latestTrace,
    aiSpanCount: left.aiSpanCount + right.aiSpanCount,
    commandCount: left.commandCount + right.commandCount,
    durationMs: getDurationMs(startedAt, lastSeenAt),
    errorCount: left.errorCount + right.errorCount,
    lastSeenAt,
    matchedOrganizationDomain:
      left.matchedOrganizationDomain || right.matchedOrganizationDomain,
    repoName: latestTrace.repoName ?? left.repoName ?? right.repoName,
    repoOwner: latestTrace.repoOwner ?? left.repoOwner ?? right.repoOwner,
    sandboxCreateCount: left.sandboxCreateCount + right.sandboxCreateCount,
    sandboxName:
      latestTrace.sandboxName ?? left.sandboxName ?? right.sandboxName,
    sessionId: latestTrace.sessionId ?? left.sessionId ?? right.sessionId,
    sessionTitle:
      latestTrace.sessionTitle ?? left.sessionTitle ?? right.sessionTitle,
    spanCount: left.spanCount + right.spanCount,
    spans: mergeSessionTraceSpans(left.spans, right.spans, startedAt),
    startedAt,
    traceId: latestTrace.traceId,
    traceIds: uniqueStrings([
      ...(left.traceIds ?? [left.traceId]),
      ...(right.traceIds ?? [right.traceId]),
    ]),
    userId: latestTrace.userId ?? left.userId ?? right.userId,
    username: latestTrace.username ?? left.username ?? right.username,
    workflowRunId:
      latestTrace.workflowRunId ?? left.workflowRunId ?? right.workflowRunId,
  };
}

function mergeSessionTraceSpans(
  left: RawTreeSandboxTraceSummary["spans"],
  right: RawTreeSandboxTraceSummary["spans"],
  sessionStartedAt: string | null,
): RawTreeSandboxTraceSummary["spans"] {
  return [...left, ...right]
    .sort((leftSpan, rightSpan) =>
      compareIso(leftSpan.startTime, rightSpan.startTime),
    )
    .map((span) => ({
      ...span,
      offsetMs: getDurationMs(sessionStartedAt, span.startTime),
    }));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function compareIso(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left ?? "").localeCompare(right ?? "");
}

function minIso(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }

  return left <= right ? left : right;
}

function maxIso(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }

  return left >= right ? left : right;
}

function getDurationMs(
  startedAt: string | null,
  lastSeenAt: string | null,
): number {
  if (!startedAt || !lastSeenAt) {
    return 0;
  }

  return Math.max(
    new Date(lastSeenAt).getTime() - new Date(startedAt).getTime(),
    0,
  );
}
