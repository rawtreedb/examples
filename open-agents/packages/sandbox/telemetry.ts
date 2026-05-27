import {
  SpanStatusCode,
  trace,
  type AttributeValue,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

export type SandboxTelemetryAttributes = Record<
  string,
  AttributeValue | undefined
>;

const tracer = trace.getTracer("@open-agents/sandbox");

export function startSandboxSpan(
  name: string,
  attributes: SandboxTelemetryAttributes,
): Span {
  return tracer.startSpan(name, { attributes: compactAttributes(attributes) });
}

export async function withSandboxSpan<T>(
  name: string,
  attributes: SandboxTelemetryAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
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

export function recordSpanError(span: Span, error: unknown): void {
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  span.recordException(normalizedError);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: normalizedError.message,
  });
}

export function setSpanStatusFromExitCode(
  span: Span,
  exitCode: number | null,
): void {
  if (exitCode === 0) {
    span.setStatus({ code: SpanStatusCode.OK });
    return;
  }

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message:
      exitCode === null
        ? "Command did not return an exit code"
        : `Command exited with ${exitCode}`,
  });
}

function compactAttributes(attributes: SandboxTelemetryAttributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined),
  ) as Attributes;
}
