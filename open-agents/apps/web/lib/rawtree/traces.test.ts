import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const insertRawTreeRowsMock = mock(async () => undefined);
const queryRawTreeMock = mock(async (_sql: string): Promise<unknown[]> => []);

mock.module("./client", () => ({
  insertRawTreeRows: insertRawTreeRowsMock,
  queryRawTree: queryRawTreeMock,
  sqlIdentifier: (value: string) => `\`${value}\``,
  sqlStringLiteral: (value: string) => `'${value.replaceAll("'", "''")}'`,
}));

const tracesModulePromise = import("./traces");

beforeEach(() => {
  queryRawTreeMock.mockClear();
  queryRawTreeMock.mockImplementation(async () => []);
});

describe("RawTree sandbox traces", () => {
  test("counts command spans that inherit org identity through traceId", async () => {
    const { getRawTreeOrganizationSandboxTraces } = await tracesModulePromise;
    queryRawTreeMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain("FROM `open_agents_traces`");
      expect(sql).not.toContain("__raw_data");
      return [
        traceRow({
          attributes: [
            attr("user.email_domain", "tinybird.co"),
            attr("user.id", "user-1"),
            attr("user.username", "rafa"),
            attr("repo.owner", "rawtree"),
            attr("repo.name", "examples"),
            attr("session.id", "session-1"),
            attr("session.title", "Telemetry demo"),
            attr("workflow.run_id", "workflow-1"),
          ],
          name: "open-agents.agent.step",
          traceId: "trace-1",
        }),
        traceRow({
          attributes: [
            attr("http.method", "POST"),
            attr("http.route", "/api/chat"),
          ],
          name: "POST /api/chat",
          traceId: "trace-1",
        }),
        traceRow({
          attributes: [
            attr("sandbox.name", "session_1"),
            attr("sandbox.session_id", "sbx_1"),
            attr("sandbox.command", "bash -c pnpm test"),
            attr("sandbox.command.phase", "agent"),
          ],
          name: "sandbox.command",
          traceId: "trace-1",
        }),
        traceRow({
          attributes: [
            attr("sandbox.name", "session_1"),
            attr("sandbox.session_id", "sbx_1"),
            attr("sandbox.command", "pnpm test"),
            attr("sandbox.command.exit_code", 0),
          ],
          name: "sandbox.exec",
          traceId: "trace-1",
        }),
        traceRow({
          attributes: [
            attr("user.email_domain", "example.com"),
            attr("sandbox.name", "session_2"),
            attr("sandbox.session_id", "sbx_2"),
            attr("sandbox.command", "git status"),
          ],
          name: "sandbox.command",
          traceId: "trace-2",
        }),
      ];
    });

    const traces = await getRawTreeOrganizationSandboxTraces("tinybird.co");

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      aiSpanCount: 0,
      commandCount: 1,
      durationMs: 100,
      errorCount: 0,
      lastSeenAt: "2026-05-26T10:00:00.100Z",
      repoName: "examples",
      repoOwner: "rawtree",
      sandboxCreateCount: 0,
      sandboxName: "session_1",
      sessionId: "session-1",
      sessionTitle: "Telemetry demo",
      spanCount: 3,
      startedAt: "2026-05-26T10:00:00.000Z",
      traceId: "trace-1",
      userId: "user-1",
      username: "rafa",
      workflowRunId: "workflow-1",
    });
    expect(
      traces[0]?.spans.map(({ category, detail, name }) => ({
        category,
        detail,
        name,
      })),
    ).toEqual([
      {
        category: "agent",
        detail: null,
        name: "open-agents.agent.step",
      },
      {
        category: "sandbox",
        detail: "bash -c pnpm test",
        name: "sandbox.command",
      },
      {
        category: "sandbox",
        detail: "pnpm test",
        name: "sandbox.exec",
      },
    ]);
  });

  test("applies selected user filters at the trace level", async () => {
    const { getRawTreeOrganizationSandboxTraces } = await tracesModulePromise;
    queryRawTreeMock.mockImplementationOnce(async () => [
      traceRow({
        attributes: [
          attr("user.email_domain", "tinybird.co"),
          attr("user.id", "user-1"),
        ],
        name: "open-agents.agent.step",
        traceId: "trace-1",
      }),
      traceRow({
        attributes: [attr("sandbox.name", "session_1")],
        name: "sandbox.command",
        traceId: "trace-1",
      }),
    ]);

    await expect(
      getRawTreeOrganizationSandboxTraces("tinybird.co", {
        userIds: ["user-2"],
      }),
    ).resolves.toEqual([]);
  });

  test("uses AI SDK telemetry metadata for organization identity", async () => {
    const { getRawTreeOrganizationSandboxTraces } = await tracesModulePromise;
    queryRawTreeMock.mockImplementationOnce(async () => [
      traceRow({
        attributes: [
          attr("ai.operationId", "ai.streamText"),
          attr("ai.telemetry.metadata.user.email_domain", "tinybird.co"),
          attr("ai.telemetry.metadata.user.id", "user-1"),
          attr("ai.telemetry.metadata.repo.owner", "rawtree"),
          attr("ai.telemetry.metadata.repo.name", "examples"),
          attr("ai.telemetry.metadata.session.id", "session-1"),
          attr("ai.telemetry.metadata.session.title", "Telemetry demo"),
          attr("ai.model.id", "openai/gpt-5.4-nano"),
        ],
        name: "ai.streamText",
        traceId: "trace-1",
      }),
      traceRow({
        attributes: [
          attr("sandbox.name", "session_1"),
          attr("sandbox.command", "git status"),
        ],
        name: "sandbox.command",
        traceId: "trace-1",
      }),
    ]);

    const traces = await getRawTreeOrganizationSandboxTraces("tinybird.co");

    expect(traces?.[0]).toMatchObject({
      aiSpanCount: 1,
      commandCount: 1,
      repoName: "examples",
      repoOwner: "rawtree",
      sessionId: "session-1",
      sessionTitle: "Telemetry demo",
      userId: "user-1",
    });
  });

  test("keeps domainless session sandbox traces for metadata enrichment", async () => {
    const { getRawTreeOrganizationSandboxTraces } = await tracesModulePromise;
    queryRawTreeMock.mockImplementationOnce(async () => [
      traceRow({
        attributes: [
          attr("sandbox.name", "session_1"),
          attr("sandbox.command", "git status"),
        ],
        name: "sandbox.command",
        traceId: "trace-1",
      }),
    ]);

    const traces = await getRawTreeOrganizationSandboxTraces("tinybird.co");

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      matchedOrganizationDomain: false,
      sandboxName: "session_1",
      traceId: "trace-1",
    });
  });

  test("can include AI session traces without sandbox activity", async () => {
    const { getRawTreeOrganizationSandboxTraces } = await tracesModulePromise;
    queryRawTreeMock.mockImplementation(async () => [
      traceRow({
        attributes: [
          attr("ai.operationId", "ai.streamText"),
          attr("ai.telemetry.metadata.user.email_domain", "tinybird.co"),
          attr("ai.telemetry.metadata.session.id", "session-1"),
        ],
        name: "ai.streamText",
        traceId: "trace-1",
      }),
    ]);

    await expect(
      getRawTreeOrganizationSandboxTraces("tinybird.co"),
    ).resolves.toEqual([]);
    await expect(
      getRawTreeOrganizationSandboxTraces("tinybird.co", {
        includeSessionProductTraces: true,
      }),
    ).resolves.toMatchObject([
      {
        aiSpanCount: 1,
        sessionId: "session-1",
        traceId: "trace-1",
      },
    ]);
  });
});

function traceRow({
  attributes,
  name,
  traceId,
}: {
  attributes: unknown[];
  name: string;
  traceId: string;
}) {
  return {
    attributes,
    endTimeUnixNano: "1779789600100000000",
    name,
    parentSpanId: "parent-1",
    spanId: `${name}-span`,
    startTimeUnixNano: "1779789600000000000",
    status: { code: 1 },
    traceId,
  };
}

function attr(key: string, value: boolean | number | string) {
  if (typeof value === "boolean") {
    return { key, value: { boolValue: value } };
  }

  if (typeof value === "number") {
    return { key, value: { intValue: value } };
  }

  return { key, value: { stringValue: value } };
}
