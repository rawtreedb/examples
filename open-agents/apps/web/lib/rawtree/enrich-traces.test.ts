import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { RawTreeSandboxTraceSummary } from "./traces";

mock.module("server-only", () => ({}));

const getSessionTraceMetadataByIdsMock = mock(
  async (
    _sessionIds: string[],
    _domain?: string,
  ): Promise<
    Map<
      string,
      {
        createdAt: Date;
        id: string;
        repoName: string | null;
        repoOwner: string | null;
        title: string;
        userId: string;
        username: string;
      }
    >
  > => new Map(),
);

mock.module("@/lib/db/sessions", () => ({
  getSessionTraceMetadataByIds: getSessionTraceMetadataByIdsMock,
}));

const enrichTracesModulePromise = import("./enrich-traces");

beforeEach(() => {
  getSessionTraceMetadataByIdsMock.mockClear();
  getSessionTraceMetadataByIdsMock.mockImplementation(
    async (_sessionIds: string[], _domain?: string) => new Map(),
  );
});

describe("RawTree trace enrichment", () => {
  test("keeps domainless sandbox traces when session metadata matches the organization", async () => {
    const { enrichSandboxTracesWithSessionMetadata } =
      await enrichTracesModulePromise;
    getSessionTraceMetadataByIdsMock.mockImplementationOnce(
      async (sessionIds: string[], domain: string | undefined) => {
        expect(sessionIds).toEqual(["session-1"]);
        expect(domain).toBe("tinybird.co");
        return new Map([
          [
            "session-1",
            {
              createdAt: new Date("2026-05-27T17:43:12.000Z"),
              id: "session-1",
              repoName: "rawtree-sandbox-demo-app",
              repoOwner: "rmorehig",
              title: "Fix tracing",
              userId: "user-1",
              username: "rmoreno",
            },
          ],
        ]);
      },
    );

    const traces = await enrichSandboxTracesWithSessionMetadata("tinybird.co", [
      traceSummary({
        matchedOrganizationDomain: false,
        sandboxName: "session_session-1",
      }),
    ]);

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      repoName: "rawtree-sandbox-demo-app",
      repoOwner: "rmorehig",
      sessionId: "session-1",
      sessionTitle: "Fix tracing",
      startedAt: "2026-05-27T17:43:12.000Z",
      userId: "user-1",
      username: "rmoreno",
    });
  });

  test("drops domainless sandbox traces without organization session metadata", async () => {
    const { enrichSandboxTracesWithSessionMetadata } =
      await enrichTracesModulePromise;

    const traces = await enrichSandboxTracesWithSessionMetadata("tinybird.co", [
      traceSummary({
        matchedOrganizationDomain: false,
        sandboxName: "session_unknown",
      }),
    ]);

    expect(traces).toEqual([]);
  });

  test("keeps raw organization-matched traces without session metadata", async () => {
    const { enrichSandboxTracesWithSessionMetadata } =
      await enrichTracesModulePromise;

    const traces = await enrichSandboxTracesWithSessionMetadata("tinybird.co", [
      traceSummary({
        matchedOrganizationDomain: true,
        sessionId: "session-1",
      }),
    ]);

    expect(traces).toHaveLength(1);
    expect(traces[0]?.sessionId).toBe("session-1");
  });

  test("summarizes multiple trace segments into one session row", async () => {
    const { summarizeSandboxTracesBySession } = await enrichTracesModulePromise;

    const traces = summarizeSandboxTracesBySession([
      traceSummary({
        commandCount: 2,
        errorCount: 1,
        lastSeenAt: "2026-05-27T17:45:00.000Z",
        sessionId: "session-1",
        spanCount: 4,
        startedAt: "2026-05-27T17:44:00.000Z",
        traceId: "latest-trace",
      }),
      traceSummary({
        aiSpanCount: 3,
        commandCount: 0,
        lastSeenAt: "2026-05-27T17:43:30.000Z",
        sessionId: "session-1",
        spanCount: 3,
        startedAt: "2026-05-27T17:43:00.000Z",
        traceId: "older-trace",
      }),
      traceSummary({
        lastSeenAt: "2026-05-27T17:42:00.000Z",
        sessionId: "session-2",
        traceId: "other-session",
      }),
    ]);

    expect(traces).toHaveLength(2);
    expect(traces[0]).toMatchObject({
      aiSpanCount: 3,
      commandCount: 2,
      durationMs: 120_000,
      errorCount: 1,
      lastSeenAt: "2026-05-27T17:45:00.000Z",
      sessionId: "session-1",
      spanCount: 7,
      startedAt: "2026-05-27T17:43:00.000Z",
      traceId: "latest-trace",
    });
  });
});

function traceSummary(
  overrides: Partial<RawTreeSandboxTraceSummary> = {},
): RawTreeSandboxTraceSummary {
  return {
    aiSpanCount: 0,
    commandCount: 1,
    durationMs: 100,
    errorCount: 0,
    lastSeenAt: "2026-05-27T17:43:12.100Z",
    matchedOrganizationDomain: false,
    repoName: null,
    repoOwner: null,
    sandboxCreateCount: 0,
    sandboxName: null,
    sessionId: null,
    sessionTitle: null,
    spanCount: 1,
    spans: [],
    startedAt: null,
    traceId: "trace-1",
    userId: null,
    username: null,
    workflowRunId: null,
    ...overrides,
  };
}
