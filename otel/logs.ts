import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { RawTree } from "@rawtree/sdk";
import {
  formatLogRow,
  requiredEnv,
  sqlStringLiteral,
  tableIdentifier,
  type RawTreeLogRow,
} from "./utils.js";

const rawtreeApiUrl = "https://api.rawtree.com";
const rawtreeTable = "otel_logs";
const serviceName = "rawtree-otel-logs";
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
