import "server-only";

import {
  SpanStatusCode,
  trace,
  type AttributeValue,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-node";
import { isRawTreeProductSpan } from "./product-spans";

export const RAWTREE_TRACES_TABLE = "open_agents_traces";

type RawTreeTracingRegistration = {
  endpoint: string;
  provider: NodeTracerProvider;
  serviceName: string;
  tableName: string;
};

type GlobalWithRawTreeTracing = typeof globalThis & {
  __openAgentsRawTreeTracing?: RawTreeTracingRegistration;
};

export type RawTreeSpanAttributes = Record<string, AttributeValue | undefined>;

const RAWTREE_API_URL = "https://api.rawtree.com";
const DEFAULT_SERVICE_NAME = "open-agents-web";

export function registerRawTreeTracing(
  serviceName = DEFAULT_SERVICE_NAME,
): RawTreeTracingRegistration {
  const globalState = globalThis as GlobalWithRawTreeTracing;
  if (globalState.__openAgentsRawTreeTracing !== undefined) {
    return globalState.__openAgentsRawTreeTracing;
  }

  const apiKey = process.env.RAWTREE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set RAWTREE_API_KEY to use RawTree tracing.");
  }

  const endpoint = `${RAWTREE_API_URL}/v1/tables/${encodeURIComponent(
    RAWTREE_TRACES_TABLE,
  )}?transform=otlp-traces`;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new ProductSpanExporter(
          new OTLPTraceExporter({
            url: endpoint,
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          }),
        ),
      ),
    ],
  });

  provider.register();

  globalState.__openAgentsRawTreeTracing = {
    endpoint,
    provider,
    serviceName,
    tableName: RAWTREE_TRACES_TABLE,
  };

  return globalState.__openAgentsRawTreeTracing;
}

export async function forceFlushRawTreeTracing(): Promise<void> {
  const registration = registerRawTreeTracing();
  await registration.provider.forceFlush();
}

export function getRawTreeTracer() {
  registerRawTreeTracing();
  return trace.getTracer(DEFAULT_SERVICE_NAME);
}

export async function withRawTreeSpan<T>(
  name: string,
  attributes: RawTreeSpanAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  registerRawTreeTracing();
  const tracer = trace.getTracer(DEFAULT_SERVICE_NAME);

  return tracer.startActiveSpan(
    name,
    { attributes: compactAttributes(attributes) },
    async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function compactSpanAttributes(
  attributes: RawTreeSpanAttributes,
): Record<string, AttributeValue> {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      (entry): entry is [string, AttributeValue] => entry[1] !== undefined,
    ),
  );
}

export function getEmailDomain(
  email: string | null | undefined,
): string | undefined {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  return domain || undefined;
}

function recordSpanError(span: Span, error: unknown): void {
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  span.recordException(normalizedError);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: normalizedError.message,
  });
}

function compactAttributes(attributes: RawTreeSpanAttributes): Attributes {
  return compactSpanAttributes(attributes);
}

class ProductSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: ExportResultCode; error?: Error }) => void,
  ): void {
    const productSpans = spans.filter((span) =>
      isRawTreeProductSpan(span.name, span.attributes),
    );

    if (productSpans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    this.delegate.export(productSpans, resultCallback);
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}
