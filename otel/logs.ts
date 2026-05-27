import { randomUUID } from "node:crypto";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { RawTree } from "@rawtree/sdk";

type RawTreeLogRow = {
  attributes?: unknown;
  body?: unknown;
  runId?: unknown;
  scopeName?: unknown;
  serviceName?: unknown;
  severityText?: unknown;
};

const rawtreeApiUrl = "https://api.rawtree.com";
const rawtreeTable = "otel_node_logs";
const serviceName = "rawtree-node-otel-logs";
const runId = randomUUID();
const endpoint = `${rawtreeApiUrl}/v1/tables/${encodeURIComponent(
  rawtreeTable,
)}?transform=otlp-logs`;

const sdk = new NodeSDK({
  autoDetectResources: false,
  resource: resourceFromAttributes({
    "service.name": serviceName,
    "demo.run_id": runId,
  }),
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: endpoint,
        headers: {
          Authorization: `Bearer ${requiredEnv("RAWTREE_API_KEY")}`,
        },
      }),
    ),
  ],
});

sdk.start();

const logger = logs.getLogger("rawtree-example");

logger.emit({
  severityNumber: SeverityNumber.INFO,
  severityText: "INFO",
  body: "agent run started",
  attributes: {
    "agent.name": "docs-adapter",
    "step.index": 1,
  },
});

logger.emit({
  severityNumber: SeverityNumber.WARN,
  severityText: "WARN",
  body: "sandbox command took longer than expected",
  attributes: {
    "agent.name": "docs-adapter",
    "command.duration_ms": 1850,
    "step.index": 2,
  },
});

logger.emit({
  severityNumber: SeverityNumber.ERROR,
  severityText: "ERROR",
  body: "tool call failed",
  attributes: {
    "agent.name": "docs-adapter",
    "error.type": "ToolCallError",
    retryable: true,
    "step.index": 3,
  },
});

await sdk.shutdown();
await sleep(1500);

console.log("rawtree_endpoint:", endpoint);
console.log("rawtree_table:", rawtreeTable);
console.log("run_id:", runId);
console.log();

const rawtree = new RawTree({
  apiKey: requiredEnv("RAWTREE_API_KEY"),
});

const result = await rawtree.query<RawTreeLogRow>(`
  SELECT
    severityText,
    body,
    attributes,
    \`service.name\` AS serviceName,
    \`scope.name\` AS scopeName,
    \`demo.run_id\` AS runId
  FROM ${tableIdentifier(rawtreeTable)}
  WHERE \`demo.run_id\` = ${sqlStringLiteral(runId)}
  ORDER BY observedTimeUnixNano ASC
  LIMIT 20
`);

console.log(`RawTree logs (${result.data.length} rows)`);
for (const row of result.data) {
  console.log(formatLogRow(row));
}

function formatLogRow(row: RawTreeLogRow): string {
  const parts = [
    `[${stringValue(row.severityText) || "UNKNOWN"}]`,
    bodyValue(row.body),
    `service=${stringValue(row.serviceName) || "unknown"}`,
  ];
  const scopeName = stringValue(row.scopeName);
  if (scopeName) {
    parts.push(`scope=${scopeName}`);
  }
  return parts.join(" ");
}

function bodyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && typeof value.stringValue === "string") {
    return value.stringValue;
  }
  return JSON.stringify(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
