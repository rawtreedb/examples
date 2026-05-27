import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { SpanStatusCode, trace } from "@opentelemetry/api";
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
} from "../lib/trace-timeline.js";
import {
  requireRunTraceId,
  requiredEnv,
  sqlStringLiteral,
  tableIdentifier,
  withSpan,
} from "./utils.js";

const rawtreeTable = "otel_traces";
const serviceName = "rawtree-otel-traces";
const runId = randomUUID();
const endpoint = `https://api.rawtree.com/v1/tables/${rawtreeTable}?transform=otlp-traces`;

const traceExporter = new OTLPTraceExporter({
  url: endpoint,
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

await withSpan(
  tracer,
  "agent.run",
  { "demo.run_id": runId },
  async (rootSpan) => {
    runTraceId = rootSpan.spanContext().traceId;

    await withSpan(
      tracer,
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
      tracer,
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
      tracer,
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

    rootSpan.setAttribute("demo.trace_id", requireRunTraceId(runTraceId));
  },
);

await provider.forceFlush();
await sleep(1500);

console.log("rawtree_endpoint:", endpoint);
console.log("rawtree_table:", rawtreeTable);
console.log("run_id:", runId);
console.log("trace_id:", requireRunTraceId(runTraceId));
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
  WHERE traceId = ${sqlStringLiteral(requireRunTraceId(runTraceId))}
  ORDER BY startTimeUnixNano ASC
  LIMIT 50
`);

printTraceTimeline({
  rows: result.data,
  runId,
  tableName: rawtreeTable,
  traceId: requireRunTraceId(runTraceId),
});

await provider.shutdown();
