import process from "node:process";
import {
  SpanStatusCode,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

export type RawTreeLogRow = {
  attributes?: unknown;
  body?: unknown;
  runId?: unknown;
  scopeName?: unknown;
  serviceName?: unknown;
  severityText?: unknown;
};

export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
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
  });
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in .env.local before running the example.`);
  }
  return value;
}

export function requireRunTraceId(value: string | undefined): string {
  if (!value) {
    throw new Error("Trace id was not recorded for this run.");
  }
  return value;
}

export function formatLogRow(row: RawTreeLogRow): string {
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

export function tableIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid RawTree table name: ${value}`);
  }
  return `\`${value}\``;
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
