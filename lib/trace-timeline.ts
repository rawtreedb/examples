export type TraceTimelineRow = {
  name?: unknown;
  traceId?: unknown;
  spanId?: unknown;
  parentSpanId?: unknown;
  kind?: unknown;
  status?: unknown;
  serviceName?: unknown;
  scopeName?: unknown;
  startTimeUnixNano?: unknown;
  endTimeUnixNano?: unknown;
  attributes?: unknown;
};

export type TraceTimelineOptions = {
  rows: TraceTimelineRow[];
  runId: string;
  tableName: string;
  traceId: string;
  colors?: boolean;
};

type TraceSpan = {
  attributes: Record<string, unknown>;
  children: TraceSpan[];
  durationNs?: bigint;
  endNs?: bigint;
  kind: string;
  name: string;
  parentSpanId: string;
  scopeName: string;
  serviceName: string;
  spanId: string;
  startNs?: bigint;
  status: SpanStatus;
};

type SpanStatus = {
  code: number;
  message: string;
};

type Styles = {
  bold(value: string): string;
  dim(value: string): string;
  green(value: string): string;
  red(value: string): string;
  yellow(value: string): string;
};

const OTLP_SPAN_KIND: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "INTERNAL",
  2: "SERVER",
  3: "CLIENT",
  4: "PRODUCER",
  5: "CONSUMER",
};

export function printTraceTimeline(options: TraceTimelineOptions): void {
  console.log(formatTraceTimeline(options));
}

export function formatTraceTimeline({
  rows,
  runId,
  tableName,
  traceId,
  colors = shouldUseColor(),
}: TraceTimelineOptions): string {
  const styles = createStyles(colors);
  const spans = rows.map(normalizeSpan).sort(compareSpans);

  if (spans.length === 0) {
    return [
      styles.bold("RawTree trace timeline"),
      `trace_id  ${traceId}`,
      `run_id    ${runId}`,
      `table     ${tableName}`,
      "",
      styles.yellow("No spans found for this trace yet."),
    ].join("\n");
  }

  const { roots, traceStartNs, traceEndNs } = buildTraceTree(spans);
  const serviceName = firstDefined(spans.map((span) => span.serviceName));
  const totalDuration = formatDurationNs(
    traceStartNs !== undefined && traceEndNs !== undefined
      ? traceEndNs - traceStartNs
      : undefined,
  );

  const lines = [
    styles.bold("RawTree trace timeline"),
    `trace_id  ${traceId}`,
    `run_id    ${runId}`,
    `table     ${tableName}`,
    `spans     ${spans.length} | duration ${totalDuration} | service ${
      serviceName || "unknown"
    }`,
    "",
  ];

  for (const [index, root] of roots.entries()) {
    renderSpan({
      isLast: index === roots.length - 1,
      lines,
      prefix: "",
      span: root,
      styles,
      traceStartNs,
    });
  }

  return lines.join("\n");
}

function normalizeSpan(row: TraceTimelineRow): TraceSpan {
  const startNs = toBigInt(row.startTimeUnixNano);
  const endNs = toBigInt(row.endTimeUnixNano);
  const durationNs =
    startNs !== undefined && endNs !== undefined && endNs >= startNs
      ? endNs - startNs
      : undefined;

  return {
    attributes: normalizeOtlpAttributes(row.attributes),
    children: [],
    durationNs,
    endNs,
    kind: formatSpanKind(row.kind),
    name: stringValue(row.name) || "(unnamed span)",
    parentSpanId: stringValue(row.parentSpanId),
    scopeName: stringValue(row.scopeName),
    serviceName: stringValue(row.serviceName),
    spanId: stringValue(row.spanId),
    startNs,
    status: normalizeStatus(row.status),
  };
}

function buildTraceTree(spans: TraceSpan[]): {
  roots: TraceSpan[];
  traceEndNs?: bigint;
  traceStartNs?: bigint;
} {
  const spansById = new Map<string, TraceSpan>();
  for (const span of spans) {
    if (span.spanId) {
      spansById.set(span.spanId, span);
    }
  }

  const roots: TraceSpan[] = [];
  for (const span of spans) {
    const parent = span.parentSpanId
      ? spansById.get(span.parentSpanId)
      : undefined;

    if (parent) {
      parent.children.push(span);
    } else {
      roots.push(span);
    }
  }

  sortTree(roots);

  return {
    roots,
    traceEndNs: maxBigInt(spans.map((span) => span.endNs)),
    traceStartNs: minBigInt(spans.map((span) => span.startNs)),
  };
}

function renderSpan({
  isLast,
  lines,
  prefix,
  span,
  styles,
  traceStartNs,
}: {
  isLast: boolean;
  lines: string[];
  prefix: string;
  span: TraceSpan;
  styles: Styles;
  traceStartNs?: bigint;
}): void {
  const branch = prefix ? (isLast ? "`-- " : "|-- ") : "";
  const offset = formatOffsetNs(span.startNs, traceStartNs).padStart(8);
  const duration = formatDurationNs(span.durationNs).padStart(8);
  const status = styleStatus(span.status, styles);
  const kind = span.kind ? styles.dim(` ${span.kind}`) : "";

  lines.push(`${prefix}${branch}${offset} ${duration} ${status} ${span.name}${kind}`);

  const continuationPrefix = `${prefix}${isLast ? "    " : "|   "}`;
  const detailPrefix = prefix ? continuationPrefix : "    ";
  const detailLines = summarizeSpan(span);
  for (const detail of detailLines) {
    lines.push(`${detailPrefix}${styles.dim(detail)}`);
  }

  for (const [index, child] of span.children.entries()) {
    renderSpan({
      isLast: index === span.children.length - 1,
      lines,
      prefix: continuationPrefix,
      span: child,
      styles,
      traceStartNs,
    });
  }
}

function summarizeSpan(span: TraceSpan): string[] {
  const parts: string[] = [];
  const attrs = span.attributes;

  appendPart(parts, "operation", attrs["ai.operationId"]);
  appendPart(parts, "function", attrs["ai.telemetry.functionId"]);
  if (span.scopeName && span.scopeName !== span.serviceName) {
    appendPart(parts, "scope", span.scopeName);
  }
  appendPart(
    parts,
    "model",
    attrs["gen_ai.request.model"] ?? attrs["gen_ai.response.model"] ?? attrs["ai.response.model"],
  );
  appendPart(parts, "finish", attrs["ai.response.finishReason"]);
  appendTokens(parts, attrs);
  appendPart(parts, "tool", attrs["ai.toolCall.name"]);
  appendPart(parts, "provider", attrs["sandbox.provider"]);
  appendPart(parts, "runtime", attrs["sandbox.runtime"]);
  appendPart(parts, "sandbox", attrs["sandbox.name"]);
  appendPart(
    parts,
    "session",
    attrs["sandbox.session_id"] === undefined
      ? undefined
      : shortenMiddle(attrs["sandbox.session_id"]),
  );
  appendPart(parts, "sandbox_status", attrs["sandbox.status"]);
  appendPart(parts, "destination", attrs["bash_tool.destination"]);
  appendPart(parts, "command", attrs["sandbox.command"], 96);
  appendPart(parts, "exit", attrs["sandbox.command.exit_code"]);
  appendPart(parts, "stdout_bytes", attrs["sandbox.command.stdout_bytes"]);
  appendPart(parts, "stderr_bytes", attrs["sandbox.command.stderr_bytes"]);

  if (span.status.code === 2 && span.status.message) {
    appendPart(parts, "error", span.status.message, 120);
  }

  return chunkParts(parts, 3).map((chunk) => chunk.join("  "));
}

function appendTokens(parts: string[], attrs: Record<string, unknown>): void {
  const input =
    attrs["ai.usage.inputTokens"] ?? attrs["gen_ai.usage.input_tokens"];
  const output =
    attrs["ai.usage.outputTokens"] ?? attrs["gen_ai.usage.output_tokens"];
  const total = attrs["ai.usage.totalTokens"];

  if (input !== undefined || output !== undefined) {
    parts.push(`tokens=${formatAttributeValue(input)}/${formatAttributeValue(output)}`);
    return;
  }

  appendPart(parts, "tokens", total);
}

function appendPart(
  parts: string[],
  key: string,
  value: unknown,
  maxLength = 64,
): void {
  if (value === undefined || value === null || value === "") {
    return;
  }

  parts.push(`${key}=${truncate(formatAttributeValue(value), maxLength)}`);
}

function normalizeOtlpAttributes(input: unknown): Record<string, unknown> {
  const attributes = parseJsonValue(input);
  if (!Array.isArray(attributes)) {
    return {};
  }

  const normalized: Record<string, unknown> = {};
  for (const attribute of attributes) {
    const item = asObject(attribute);
    if (!item) {
      continue;
    }

    const key = stringValue(item.key);
    if (!key) {
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
  if (arrayValue && Array.isArray(arrayValue.values)) {
    return arrayValue.values.map(unwrapOtlpValue);
  }

  const kvlistValue = asObject(object.kvlistValue);
  if (kvlistValue && Array.isArray(kvlistValue.values)) {
    return Object.fromEntries(
      kvlistValue.values.flatMap((entry) => {
        const item = asObject(entry);
        const key = item ? stringValue(item.key) : "";
        return key ? [[key, unwrapOtlpValue(item?.value)]] : [];
      }),
    );
  }

  return value;
}

function normalizeStatus(input: unknown): SpanStatus {
  const value = parseJsonValue(input);
  const object = asObject(value);
  if (!object) {
    return { code: 0, message: "" };
  }

  return {
    code: numberValue(object.code) ?? 0,
    message: stringValue(object.message),
  };
}

function styleStatus(status: SpanStatus, styles: Styles): string {
  if (status.code === 2) {
    return styles.red("ERROR");
  }

  if (status.code === 1) {
    return styles.green("OK");
  }

  return styles.dim("OK");
}

function formatSpanKind(input: unknown): string {
  const numericKind = numberValue(input);
  if (numericKind !== undefined) {
    return OTLP_SPAN_KIND[numericKind] ?? `KIND_${numericKind}`;
  }

  return stringValue(input);
}

function compareSpans(left: TraceSpan, right: TraceSpan): number {
  if (left.startNs !== undefined && right.startNs !== undefined) {
    if (left.startNs < right.startNs) return -1;
    if (left.startNs > right.startNs) return 1;
  }

  return left.name.localeCompare(right.name);
}

function sortTree(spans: TraceSpan[]): void {
  spans.sort(compareSpans);
  for (const span of spans) {
    sortTree(span.children);
  }
}

function formatOffsetNs(startNs: bigint | undefined, traceStartNs: bigint | undefined): string {
  if (startNs === undefined || traceStartNs === undefined) {
    return "+?";
  }

  return `+${formatDurationNs(startNs - traceStartNs)}`;
}

function formatDurationNs(value: bigint | undefined): string {
  if (value === undefined) {
    return "?";
  }

  const milliseconds = Number(value) / 1_000_000;
  if (milliseconds < 1) {
    return `${milliseconds.toFixed(2)}ms`;
  }

  if (milliseconds < 1000) {
    return `${milliseconds.toFixed(1)}ms`;
  }

  return `${(milliseconds / 1000).toFixed(2)}s`;
}

function formatAttributeValue(value: unknown): string {
  if (value === undefined) return "?";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return JSON.stringify(value) ?? String(value);
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

function parseJsonValue(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  const trimmed = input.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return input;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return input;
  }
}

function asObject(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function firstDefined(values: string[]): string {
  return values.find((value) => value.length > 0) ?? "";
}

function minBigInt(values: Array<bigint | undefined>): bigint | undefined {
  return values.reduce<bigint | undefined>((min, value) => {
    if (value === undefined) return min;
    return min === undefined || value < min ? value : min;
  }, undefined);
}

function maxBigInt(values: Array<bigint | undefined>): bigint | undefined {
  return values.reduce<bigint | undefined>((max, value) => {
    if (value === undefined) return max;
    return max === undefined || value > max ? value : max;
  }, undefined);
}

function chunkParts(parts: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < parts.length; index += size) {
    chunks.push(parts.slice(index, index + size));
  }
  return chunks;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function shortenMiddle(input: unknown, maxLength = 24): string {
  const value = formatAttributeValue(input);
  if (value.length <= maxLength) {
    return value;
  }

  const sideLength = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, sideLength)}...${value.slice(-sideLength)}`;
}

function shouldUseColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function createStyles(enabled: boolean): Styles {
  return {
    bold: style(enabled, "1"),
    dim: style(enabled, "2"),
    green: style(enabled, "32"),
    red: style(enabled, "31"),
    yellow: style(enabled, "33"),
  };
}

function style(enabled: boolean, code: string): (value: string) => string {
  return (value: string) => (enabled ? `\u001b[${code}m${value}\u001b[0m` : value);
}
