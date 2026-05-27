import type { Metadata } from "next";
import { TracingSection } from "../tracing-section";

export const metadata: Metadata = {
  title: "Tracing",
  description: "Organization agent traces powered by RawTree.",
};

type TracingPageProps = {
  searchParams: Promise<{
    traceId?: string | string[];
  }>;
};

function firstSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export default async function TracingPage({ searchParams }: TracingPageProps) {
  const params = await searchParams;
  const traceId = firstSearchParam(params.traceId);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Tracing</h1>
        <p className="text-sm text-muted-foreground">
          Inspect agent sessions, spans, sandbox runtimes, and commands from
          RawTree traces.
        </p>
      </div>

      <TracingSection traceId={traceId} />
    </div>
  );
}
