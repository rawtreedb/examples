import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";

const RAWTREE_API_URL = "https://api.rawtree.com";

export type RegisterRawTreeOtelOptions = {
  serviceName: string;
  tableName: string;
  apiKey?: string;
};

export type RawTreeOtelRegistration = {
  endpoint: string;
  provider: NodeTracerProvider;
  serviceName: string;
  tableName: string;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

export function registerRawTreeOtel({
  serviceName,
  tableName,
  apiKey = requiredEnv("RAWTREE_API_KEY"),
}: RegisterRawTreeOtelOptions): RawTreeOtelRegistration {
  const resolvedServiceName = requiredOption("serviceName", serviceName);
  const resolvedTableName = requiredOption("tableName", tableName);
  const resolvedApiKey = requiredOption("apiKey", apiKey);
  const endpoint = `${RAWTREE_API_URL}/v1/tables/${encodeURIComponent(
    resolvedTableName,
  )}?transform=otlp-traces`;

  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
    headers: {
      Authorization: `Bearer ${resolvedApiKey}`,
    },
  });

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": resolvedServiceName,
    }),
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });

  provider.register();

  return {
    endpoint,
    provider,
    serviceName: resolvedServiceName,
    tableName: resolvedTableName,
    forceFlush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}

function requiredOption(name: string, value: string | undefined): string {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    throw new Error(`registerRawTreeOtel requires ${name}.`);
  }
  return trimmedValue;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in .env.local before starting the demo.`);
  }
  return value;
}
