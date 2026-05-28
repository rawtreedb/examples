import type { UsageDateRange } from "@/lib/usage/date-range";
import { queryRawTree, sqlIdentifier } from "./client";
import {
  getRawTreeProductSpanCategory,
  isRawTreeSandboxSpan,
  type RawTreeProductSpanCategory,
} from "./product-spans";
import { RAWTREE_TRACES_TABLE } from "./tracing";

export type RawTreeSandboxTraceSummary = {
  aiSpanCount: number;
  commandCount: number;
  durationMs: number;
  errorCount: number;
  lastSeenAt: string | null;
  matchedOrganizationDomain?: boolean;
  repoName: string | null;
  repoOwner: string | null;
  sandboxCreateCount: number;
  sandboxName: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  spanCount: number;
  spans: RawTreeSandboxTraceSpan[];
  startedAt: string | null;
  traceId: string;
  userId: string | null;
  username: string | null;
  workflowRunId: string | null;
};

export type RawTreeSandboxTraceSpan = {
  category: RawTreeProductSpanCategory;
  depth: number;
  detail: string | null;
  durationMs: number;
  endTime: string | null;
  error: boolean;
  name: string;
  offsetMs: number;
  parentSpanId: string | null;
  spanId: string;
  startTime: string | null;
  statusCode: string | null;
};

export interface RawTreeOrganizationSandboxTraceOptions {
  days?: number;
  includeSessionProductTraces?: boolean;
  limit?: number;
  range?: UsageDateRange;
  userIds?: string[];
}

type RawTreeTraceRow = {
  attributes?: unknown;
  endTimeUnixNano?: unknown;
  name?: unknown;
  parentSpanId?: unknown;
  spanId?: unknown;
  startTimeUnixNano?: unknown;
  status?: unknown;
  traceId?: unknown;
};

type TraceAccumulator = {
  aiSpanCount: number;
  commandCount: number;
  emailDomains: Set<string>;
  endNs?: bigint;
  errorCount: number;
  hasSandboxActivity: boolean;
  repoName: string | null;
  repoOwner: string | null;
  sandboxCreateCount: number;
  sandboxName: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  spanCount: number;
  spans: TraceSpanAccumulator[];
  startNs?: bigint;
  traceId: string;
  userId: string | null;
  userIds: Set<string>;
  username: string | null;
  workflowRunId: string | null;
};

type TraceSpanAccumulator = {
  attributes: Record<string, unknown>;
  endNs?: bigint;
  error: boolean;
  name: string;
  parentSpanId: string | null;
  spanId: string;
  startNs?: bigint;
  statusCode: string | null;
};

const TRACE_QUERY_LIMIT = 5000;
const DEFAULT_TRACE_SUMMARY_LIMIT = 20;
const NANOS_PER_MS_NUMBER = 1_000_000;
const NANOS_PER_MS = BigInt(NANOS_PER_MS_NUMBER);

export async function getRawTreeOrganizationSandboxTraces(
  domain: string,
  options?: RawTreeOrganizationSandboxTraceOptions,
): Promise<RawTreeSandboxTraceSummary[]> {
  const rows = await queryRawTree<RawTreeTraceRow>(`
      SELECT
        name,
        traceId,
        spanId,
        parentSpanId,
        status,
        startTimeUnixNano,
        endTimeUnixNano,
        attributes
      FROM ${sqlIdentifier(RAWTREE_TRACES_TABLE)}
      ORDER BY startTimeUnixNano DESC
      LIMIT ${TRACE_QUERY_LIMIT}
    `);

  return summarizeSandboxTraces(rows, domain, options);
}

function summarizeSandboxTraces(
  rows: RawTreeTraceRow[],
  domain: string,
  options?: RawTreeOrganizationSandboxTraceOptions,
): RawTreeSandboxTraceSummary[] {
  const normalizedDomain = domain.trim().toLowerCase();
  const selectedUserIds = new Set(options?.userIds);
  const traces = new Map<string, TraceAccumulator>();

  for (const row of rows) {
    const traceId = stringValue(row.traceId);
    if (!traceId) {
      continue;
    }

    const attributes = normalizeOtlpAttributes(row.attributes);
    const userId = firstString(
      null,
      attributes["user.id"],
      attributes["ai.telemetry.metadata.user.id"],
    );
    const startNs = toBigInt(row.startTimeUnixNano);
    const endNs = toBigInt(row.endTimeUnixNano);
    const name = stringValue(row.name);
    const productCategory = getRawTreeProductSpanCategory(name, attributes);
    if (!productCategory) {
      continue;
    }

    const accumulator = getTraceAccumulator(traces, traceId);
    const error = isErrorStatus(row.status);

    const emailDomain = firstString(
      null,
      attributes["user.email_domain"],
      attributes["ai.telemetry.metadata.user.email_domain"],
    )?.toLowerCase();
    if (emailDomain) {
      accumulator.emailDomains.add(emailDomain);
    }
    if (userId) {
      accumulator.userIds.add(userId);
    }

    accumulator.spanCount += 1;
    accumulator.spans.push({
      attributes,
      endNs,
      error,
      name,
      parentSpanId: stringValue(row.parentSpanId) || null,
      spanId: stringValue(row.spanId),
      startNs,
      statusCode: getStatusCode(row.status),
    });
    accumulator.startNs = minBigInt(accumulator.startNs, startNs);
    accumulator.endNs = maxBigInt(accumulator.endNs, endNs ?? startNs);
    accumulator.sandboxName = firstString(
      accumulator.sandboxName,
      attributes["sandbox.name"],
    );
    accumulator.sessionId = firstString(
      accumulator.sessionId,
      attributes["session.id"],
      attributes["ai.telemetry.metadata.session.id"],
      attributes["sandbox.session_id"],
    );
    accumulator.sessionTitle = firstString(
      accumulator.sessionTitle,
      attributes["session.title"],
      attributes["ai.telemetry.metadata.session.title"],
    );
    accumulator.workflowRunId = firstString(
      accumulator.workflowRunId,
      attributes["workflow.run_id"],
      attributes["ai.telemetry.metadata.workflow.run_id"],
    );
    accumulator.repoOwner = firstString(
      accumulator.repoOwner,
      attributes["repo.owner"],
      attributes["ai.telemetry.metadata.repo.owner"],
    );
    accumulator.repoName = firstString(
      accumulator.repoName,
      attributes["repo.name"],
      attributes["ai.telemetry.metadata.repo.name"],
    );
    accumulator.userId = firstString(
      accumulator.userId,
      attributes["user.id"],
      attributes["ai.telemetry.metadata.user.id"],
    );
    accumulator.username = firstString(
      accumulator.username,
      attributes["user.username"],
      attributes["ai.telemetry.metadata.user.username"],
    );

    if (name === "sandbox.create") {
      accumulator.sandboxCreateCount += 1;
    }
    if (name === "sandbox.command") {
      accumulator.commandCount += 1;
    }
    if (productCategory === "sandbox") {
      accumulator.hasSandboxActivity = true;
    }
    if (productCategory === "ai") {
      accumulator.aiSpanCount += 1;
    }
    if (error) {
      accumulator.errorCount += 1;
    }
  }

  return [...traces.values()]
    .filter(
      (trace) =>
        trace.emailDomains.size === 0 ||
        trace.emailDomains.has(normalizedDomain),
    )
    .filter(
      (trace) =>
        selectedUserIds.size === 0 ||
        [...trace.userIds].some((userId) => selectedUserIds.has(userId)),
    )
    .filter((trace) => hasRequestedTraceActivity(trace, options))
    .filter((trace) => isInRange(trace.startNs, options?.range))
    .map((trace) => toTraceSummary(trace, normalizedDomain))
    .sort((left, right) => {
      const leftTime = left.lastSeenAt ?? "";
      const rightTime = right.lastSeenAt ?? "";
      return rightTime.localeCompare(leftTime);
    })
    .slice(0, options?.limit ?? DEFAULT_TRACE_SUMMARY_LIMIT);
}

function hasRequestedTraceActivity(
  trace: TraceAccumulator,
  options: RawTreeOrganizationSandboxTraceOptions | undefined,
): boolean {
  if (trace.hasSandboxActivity) {
    return true;
  }

  if (!options?.includeSessionProductTraces) {
    return false;
  }

  return Boolean(trace.sessionId || trace.sandboxName || trace.sessionTitle);
}

function getTraceAccumulator(
  traces: Map<string, TraceAccumulator>,
  traceId: string,
): TraceAccumulator {
  const existing = traces.get(traceId);
  if (existing) {
    return existing;
  }

  const created: TraceAccumulator = {
    aiSpanCount: 0,
    commandCount: 0,
    emailDomains: new Set(),
    errorCount: 0,
    hasSandboxActivity: false,
    repoName: null,
    repoOwner: null,
    sandboxCreateCount: 0,
    sandboxName: null,
    sessionId: null,
    sessionTitle: null,
    spanCount: 0,
    spans: [],
    traceId,
    userId: null,
    userIds: new Set(),
    username: null,
    workflowRunId: null,
  };
  traces.set(traceId, created);
  return created;
}

function toTraceSummary(
  trace: TraceAccumulator,
  domain: string,
): RawTreeSandboxTraceSummary {
  const spans = toTraceSpans(trace);

  return {
    aiSpanCount: trace.aiSpanCount,
    commandCount: trace.commandCount,
    durationMs:
      trace.startNs !== undefined &&
      trace.endNs !== undefined &&
      trace.endNs >= trace.startNs
        ? Number((trace.endNs - trace.startNs) / NANOS_PER_MS)
        : 0,
    errorCount: trace.errorCount,
    lastSeenAt: nanosToIso(trace.endNs),
    matchedOrganizationDomain: trace.emailDomains.has(domain),
    repoName: trace.repoName,
    repoOwner: trace.repoOwner,
    sandboxCreateCount: trace.sandboxCreateCount,
    sandboxName: trace.sandboxName,
    sessionId: trace.sessionId,
    sessionTitle: trace.sessionTitle,
    spanCount: trace.spanCount,
    spans,
    startedAt: nanosToIso(trace.startNs),
    traceId: trace.traceId,
    userId: trace.userId,
    username: trace.username,
    workflowRunId: trace.workflowRunId,
  };
}

function toTraceSpans(trace: TraceAccumulator): RawTreeSandboxTraceSpan[] {
  const orderedSpans = orderTraceSpans(trace.spans);
  const depthBySpanId = getDepthsBySpanId(trace.spans);

  return orderedSpans.map((span) => {
    const endNs = span.endNs ?? span.startNs;
    return {
      category:
        getRawTreeProductSpanCategory(span.name, span.attributes) ?? "agent",
      depth: depthBySpanId.get(span.spanId) ?? 0,
      detail: getSpanDetail(span.name, span.attributes),
      durationMs: getDurationMs(span.startNs, endNs),
      endTime: nanosToIso(endNs),
      error: span.error,
      name: span.name,
      offsetMs: getDurationMs(trace.startNs, span.startNs),
      parentSpanId: span.parentSpanId,
      spanId: span.spanId,
      startTime: nanosToIso(span.startNs),
      statusCode: span.statusCode,
    };
  });
}

function orderTraceSpans(
  spans: TraceSpanAccumulator[],
): TraceSpanAccumulator[] {
  const spansById = new Map(spans.map((span) => [span.spanId, span]));
  const childrenByParentId = new Map<string, TraceSpanAccumulator[]>();
  const roots: TraceSpanAccumulator[] = [];

  for (const span of spans) {
    const parent = span.parentSpanId ? spansById.get(span.parentSpanId) : null;
    if (!parent) {
      roots.push(span);
      continue;
    }

    const children = childrenByParentId.get(parent.spanId) ?? [];
    children.push(span);
    childrenByParentId.set(parent.spanId, children);
  }

  const sortByStart = (
    left: TraceSpanAccumulator,
    right: TraceSpanAccumulator,
  ) =>
    compareBigInt(left.startNs, right.startNs) ||
    left.name.localeCompare(right.name);
  roots.sort(sortByStart);
  for (const children of childrenByParentId.values()) {
    children.sort(sortByStart);
  }

  const ordered: TraceSpanAccumulator[] = [];
  const visit = (span: TraceSpanAccumulator) => {
    ordered.push(span);
    for (const child of childrenByParentId.get(span.spanId) ?? []) {
      visit(child);
    }
  };
  for (const root of roots) {
    visit(root);
  }

  return ordered;
}

function getDepthsBySpanId(spans: TraceSpanAccumulator[]): Map<string, number> {
  const spansById = new Map(spans.map((span) => [span.spanId, span]));
  const depths = new Map<string, number>();

  const resolveDepth = (
    span: TraceSpanAccumulator,
    seen = new Set<string>(),
  ): number => {
    const existing = depths.get(span.spanId);
    if (existing !== undefined) {
      return existing;
    }

    if (!span.parentSpanId || seen.has(span.spanId)) {
      depths.set(span.spanId, 0);
      return 0;
    }

    const parent = spansById.get(span.parentSpanId);
    if (!parent) {
      depths.set(span.spanId, 0);
      return 0;
    }

    seen.add(span.spanId);
    const depth = resolveDepth(parent, seen) + 1;
    depths.set(span.spanId, depth);
    return depth;
  };

  for (const span of spans) {
    resolveDepth(span);
  }

  return depths;
}

function getSpanDetail(
  name: string,
  attributes: Record<string, unknown>,
): string | null {
  if (isRawTreeSandboxSpan(name, attributes)) {
    return firstString(
      null,
      attributes["sandbox.command"],
      attributes["sandbox.command.operation"],
      attributes["sandbox.name"],
      attributes["sandbox.session_id"],
    );
  }

  if (name === "open-agents.agent.step") {
    return firstString(
      null,
      attributes["model.id"],
      attributes["agent.step_number"],
    );
  }

  if (name.startsWith("ai.") || attributes["ai.operationId"] !== undefined) {
    return firstString(
      null,
      attributes["ai.toolCall.name"],
      attributes["model.id"],
      attributes["ai.model.id"],
      attributes["ai.operationId"],
      attributes["agent.step_number"],
    );
  }

  return null;
}

function normalizeOtlpAttributes(input: unknown): Record<string, unknown> {
  const attributes = parseJsonValue(input);
  if (!Array.isArray(attributes)) {
    return {};
  }

  const normalized: Record<string, unknown> = {};
  for (const attribute of attributes) {
    const item = asObject(attribute);
    const key = stringValue(item?.key);
    if (!item || !key) {
      continue;
    }

    normalized[key] = unwrapOtlpValue(item.value);
  }

  return normalized;
}

function unwrapOtlpValue(input: unknown): unknown {
  const value = parseJsonValue(input);
  const object = asObject(value);
  if (!object) {
    return value;
  }

  if ("stringValue" in object) return object.stringValue;
  if ("intValue" in object) return object.intValue;
  if ("doubleValue" in object) return object.doubleValue;
  if ("boolValue" in object) return object.boolValue;
  if ("bytesValue" in object) return object.bytesValue;

  const arrayValue = asObject(object.arrayValue);
  if (Array.isArray(arrayValue?.values)) {
    return arrayValue.values.map(unwrapOtlpValue);
  }

  const kvlistValue = asObject(object.kvlistValue);
  if (Array.isArray(kvlistValue?.values)) {
    return Object.fromEntries(
      kvlistValue.values.flatMap((entry) => {
        const item = asObject(entry);
        const key = stringValue(item?.key);
        return key ? [[key, unwrapOtlpValue(item?.value)]] : [];
      }),
    );
  }

  return value;
}

function parseJsonValue(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function isErrorStatus(input: unknown): boolean {
  const status = asObject(parseJsonValue(input));
  const code = numberValue(status?.code);
  return code === 2 || stringValue(status?.code).toUpperCase() === "ERROR";
}

function getStatusCode(input: unknown): string | null {
  const status = asObject(parseJsonValue(input));
  const code = status?.code;
  if (code === 2 || stringValue(code).toUpperCase() === "ERROR") {
    return "ERROR";
  }
  if (code === 1 || stringValue(code).toUpperCase() === "OK") {
    return "OK";
  }
  if (code === 0 || stringValue(code).toUpperCase() === "UNSET") {
    return "UNSET";
  }

  return firstString(null, code);
}

function isInRange(
  startNs: bigint | undefined,
  range: UsageDateRange | undefined,
): boolean {
  if (!range) {
    return true;
  }

  const iso = nanosToIso(startNs);
  const date = iso?.slice(0, 10);
  return Boolean(date && date >= range.from && date <= range.to);
}

function nanosToIso(input: bigint | undefined): string | null {
  if (input === undefined) {
    return null;
  }

  return new Date(Number(input / NANOS_PER_MS)).toISOString();
}

function getDurationMs(
  startNs: bigint | undefined,
  endNs: bigint | undefined,
): number {
  if (startNs === undefined || endNs === undefined || endNs < startNs) {
    return 0;
  }

  return Number((endNs - startNs) / NANOS_PER_MS);
}

function compareBigInt(
  left: bigint | undefined,
  right: bigint | undefined,
): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }

  return left < right ? -1 : 1;
}

function maxBigInt(
  left: bigint | undefined,
  right: bigint | undefined,
): bigint | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left > right ? left : right;
}

function minBigInt(
  left: bigint | undefined,
  right: bigint | undefined,
): bigint | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left < right ? left : right;
}

function firstString(
  current: string | null,
  ...values: unknown[]
): string | null {
  if (current) {
    return current;
  }

  for (const value of values) {
    const resolved = stringValue(value);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (typeof input === "number" || typeof input === "boolean") {
    return String(input);
  }

  return "";
}

function numberValue(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }

  if (typeof input === "string") {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toBigInt(input: unknown): bigint | undefined {
  if (typeof input === "bigint") {
    return input;
  }

  if (typeof input === "number" && Number.isFinite(input)) {
    return BigInt(Math.trunc(input));
  }

  if (typeof input === "string" && /^[0-9]+$/.test(input)) {
    return BigInt(input);
  }

  return undefined;
}
