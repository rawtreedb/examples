import { randomUUID } from "node:crypto";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { context, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { Daytona } from "@daytona/sdk";
import { RawTree } from "@rawtree/sdk";
import {
  printTraceTimeline,
  type TraceTimelineRow,
} from "../lib/trace-timeline.js";

type DaytonaSandbox = Awaited<ReturnType<Daytona["create"]>>;

const serviceName = "rawtree-daytona-sandbox";
const runId = randomUUID();
const telemetry = configureRawTreeOtel();
const daytona = new Daytona({
  apiKey: requiredEnv("DAYTONA_API_KEY"),
  otelEnabled: true,
});
const tracer = trace.getTracer(serviceName);
let runTraceId: string | undefined;

try {
  await withActiveSpan(
    "example.run",
    {
      "demo.run_id": runId,
      "sandbox.provider": "daytona",
      "sandbox.runtime": "typescript",
    },
    async (span) => {
      runTraceId = span.spanContext().traceId;

      console.log("run_id:", runId);
      console.log("trace_id:", runTraceId);
      console.log("rawtree_trace_endpoint:", telemetry.traceEndpoint);
      console.log("rawtree_trace_table:", telemetry.tracesTable);

      let sandbox: DaytonaSandbox | undefined;
      try {
        sandbox = await daytona.create({
          language: "typescript",
          labels: {
            example: serviceName,
            run_id: runId,
          },
        });

        span.setAttributes({
          "sandbox.id": sandbox.id,
          "sandbox.name": sandbox.name,
          "sandbox.state": sandbox.state,
          "sandbox.target": sandbox.target,
        });

        const response = await sandbox.process.codeRun(
          [
            "const payload = {",
            "  ok: true,",
            "  runtime: process.version,",
            "  platform: process.platform,",
            "  cwd: process.cwd(),",
            `  runId: ${JSON.stringify(runId)},`,
            "};",
            "console.log(JSON.stringify(payload));",
          ].join("\n"),
        );

        span.setAttributes({
          "sandbox.command.exit_code": response.exitCode,
          "sandbox.command.stdout_bytes": byteLength(response.result),
        });

        if (response.exitCode !== 0) {
          throw new Error(`Daytona codeRun exited with ${response.exitCode}`);
        }

        console.log("sandbox_result:", response.result.trim());
      } finally {
        if (sandbox) {
          await daytona.delete(sandbox);
          span.setAttribute("sandbox.deleted", true);
        }
      }
    },
  );
} finally {
  await daytona[Symbol.asyncDispose]();
}

await sleep(1500);
await printRawTreeTraceTimeline(requireRunTraceId(runTraceId));

async function printRawTreeTraceTimeline(traceId: string): Promise<void> {
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
    FROM ${tableIdentifier(telemetry.tracesTable)}
    WHERE traceId = ${sqlStringLiteral(traceId)}
    ORDER BY startTimeUnixNano ASC
    LIMIT 100
  `);

  if (result.data.length === 0) {
    throw new Error(
      `No RawTree spans found for trace ${traceId} in ${telemetry.tracesTable}.`,
    );
  }

  printTraceTimeline({
    rows: result.data,
    runId,
    tableName: telemetry.tracesTable,
    traceId,
  });
}

async function withActiveSpan<T>(
  name: string,
  attributes: Record<string, string>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, { attributes });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
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
  });
}

function configureRawTreeOtel(): {
  traceEndpoint: string;
  tracesTable: string;
} {
  const rawtreeApiKey = requiredEnv("RAWTREE_API_KEY");
  const tracesTable = process.env.RAWTREE_TRACES_TABLE ?? "daytona_traces";
  const baseEndpoint = normalizeUrl(
    process.env.RAWTREE_OTLP_ENDPOINT ?? "https://api.rawtree.com/otlp",
  );

  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??= baseEndpoint;
  process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ??=
    `Authorization=Bearer ${rawtreeApiKey},x-rawtree-traces-table=${tracesTable}`;
  process.env.OTEL_METRICS_EXPORTER ??= "none";
  process.env.OTEL_LOGS_EXPORTER ??= "none";

  return {
    traceEndpoint:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      `${normalizeUrl(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)}/v1/traces`,
    tracesTable,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in .env.local before running the example.`);
  }
  return value;
}

function requireRunTraceId(value: string | undefined): string {
  if (!value) {
    throw new Error("Trace id was not recorded for this run.");
  }
  return value;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
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

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
