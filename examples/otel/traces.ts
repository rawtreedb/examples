import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SpanStatusCode,
  trace,
  type AttributeValue,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import { RawTree } from "@rawtree/sdk";
import {
  printTraceTimeline,
  type TraceTimelineRow,
} from "../../lib/trace-timeline.js";

type SpanAttributeInput = Record<string, AttributeValue | undefined>;

const rawtreeTable = "otel_node_traces";
const serviceName = "rawtree-node-otel-traces";
const runId = randomUUID();
const endpoint = `https://api.rawtree.com/v1/tables/${rawtreeTable}?transform=otlp-traces`;

const traceExporter = new OTLPTraceExporter({
  url: `https://api.rawtree.com/v1/tables/${rawtreeTable}?transform=otlp-traces`,
  headers: {
    Authorization: `Bearer ${requiredEnv("RAWTREE_API_KEY")}`,
  },
});

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    "service.name": serviceName,
  }),
  spanProcessors: [new BatchSpanProcessor(traceExporter)],
});
provider.register();

const tracer = trace.getTracer("rawtree-example");
let runTraceId: string | undefined;

await withSpan("agent.run", { "demo.run_id": runId }, async (rootSpan) => {
  runTraceId = rootSpan.spanContext().traceId;

  await withSpan(
    "model.generate",
    {
      "demo.run_id": runId,
      "gen_ai.request.model": "gpt-5",
      "ai.operationId": "plan",
    },
    async (span) => {
      await sleep(50);
      span.setAttributes({
        "gen_ai.usage.input_tokens": 128,
        "gen_ai.usage.output_tokens": 42,
        "ai.response.finishReason": "stop",
      });
    },
  );

  await withSpan(
    "tool.call",
    {
      "demo.run_id": runId,
      "ai.operationId": "read-file",
      "ai.toolCall.name": "bash",
      "sandbox.command": "sed -n '1,40p' README.md",
    },
    async (span) => {
      await sleep(25);
      span.setAttributes({
        "sandbox.command.exit_code": 0,
        "sandbox.command.stdout_bytes": 512,
        "sandbox.command.stderr_bytes": 0,
      });
    },
  );

  await withSpan(
    "tool.call.retry",
    {
      "demo.run_id": runId,
      "ai.operationId": "retryable-tool-call",
      "ai.toolCall.name": "fetch",
    },
    async (span) => {
      await sleep(10);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Temporary upstream timeout",
      });
      span.setAttribute("error.retryable", true);
    },
  );

  rootSpan.setAttribute("demo.trace_id", requireRunTraceId());
});

await provider.forceFlush();
await sleep(1500);

console.log("rawtree_endpoint:", endpoint);
console.log("rawtree_table:", rawtreeTable);
console.log("run_id:", runId);
console.log("trace_id:", requireRunTraceId());
console.log();

const rawtree = new RawTree({
  apiKey: requiredEnv("RAWTREE_API_KEY"),
});

const result = await rawtree.query<TraceTimelineRow>(`
  SELECT
    name,
    traceId,
    spanId,
    parentSpanId,
    kind,
    status,
    \`service.name\` AS serviceName,
    \`scope.name\` AS scopeName,
    startTimeUnixNano,
    endTimeUnixNano,
    attributes
  FROM ${tableIdentifier(rawtreeTable)}
  WHERE traceId = ${sqlStringLiteral(requireRunTraceId())}
  ORDER BY startTimeUnixNano ASC
  LIMIT 50
`);

printTraceTimeline({
  rows: result.data,
  runId,
  tableName: rawtreeTable,
  traceId: requireRunTraceId(),
});

await provider.shutdown();

async function withSpan<T>(
  name: string,
  attributes: SpanAttributeInput,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    name,
    { attributes: compact(attributes) },
    async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        const normalizedError = toError(error);
        span.recordException(normalizedError);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: normalizedError.message,
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

function requireRunTraceId(): string {
  if (!runTraceId) {
    throw new Error("Trace id was not recorded for this run.");
  }
  return runTraceId;
}

function compact(value: SpanAttributeInput): Attributes {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Attributes;
}

function tableIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid RawTree table name: ${value}`);
  }
  return `\`${value}\``;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in .env.local before running the example.`);
  }
  return value;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
