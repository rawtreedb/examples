"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/swr";
import { cn } from "@/lib/utils";

interface OrganizationSessionTrace {
  aiSpanCount: number;
  commandCount: number;
  durationMs: number;
  errorCount: number;
  lastSeenAt: string | null;
  repoName: string | null;
  repoOwner: string | null;
  sandboxCreateCount: number;
  sandboxName: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  spanCount: number;
  spans: OrganizationTraceSpan[];
  startedAt: string | null;
  traceId: string;
  userId: string | null;
  username: string | null;
  workflowRunId: string | null;
}

interface OrganizationTraceSpan {
  category: "agent" | "ai" | "sandbox";
  depth: number;
  detail: string | null;
  durationMs: number;
  endTime: string | null;
  error: boolean;
  name: string;
  offsetMs: number;
  parentSpanId: string | null;
  spanId: string;
  startTime: string | null;
  statusCode: string | null;
}

interface OrganizationTracing {
  domain: string;
  source: "rawtree";
  traces: OrganizationSessionTrace[];
}

interface OrganizationTracingResponse {
  organization: OrganizationTracing | null;
}

const RULER_TICKS = [0, 25, 50, 75, 100] as const;

const EMPTY_TRACES: OrganizationSessionTrace[] = [];
const NO_REPO_KEY = "__no_repo__";
const TRACING_PATH = "/api/tracing/organization";

function formatTraceId(traceId: string): string {
  if (traceId.length <= 18) {
    return traceId;
  }

  return `${traceId.slice(0, 10)}...${traceId.slice(-6)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Unknown";
  }

  return new Date(value).toLocaleString("en-US", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.max(Math.round(durationMs), 0)}ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  if (durationMs < 3_600_000) {
    return `${(durationMs / 60_000).toFixed(1)}m`;
  }

  return `${(durationMs / 3_600_000).toFixed(1)}h`;
}

function getTraceTitle(trace: OrganizationSessionTrace): string {
  if (trace.sessionTitle) {
    return trace.sessionTitle;
  }

  return trace.sessionId
    ? `Session ${formatTraceId(trace.sessionId)}`
    : `Trace ${formatTraceId(trace.traceId)}`;
}

function getRepoKey(trace: OrganizationSessionTrace): string {
  return trace.repoOwner && trace.repoName
    ? `${trace.repoOwner}/${trace.repoName}`
    : NO_REPO_KEY;
}

function getRepoLabel(trace: OrganizationSessionTrace): string {
  return trace.repoOwner && trace.repoName
    ? `${trace.repoOwner}/${trace.repoName}`
    : "No repo";
}

function getRepoOptions(traces: OrganizationSessionTrace[]) {
  const labels = new Map<string, string>();

  for (const trace of traces) {
    labels.set(getRepoKey(trace), getRepoLabel(trace));
  }

  return [...labels.entries()]
    .map(([value, label]) => ({ label, value }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function getSpanRowLabel(span: OrganizationTraceSpan): string {
  if (span.detail && span.detail !== span.name) {
    return span.detail;
  }

  return span.spanId;
}

function getSpanCategoryLabel(category: OrganizationTraceSpan["category"]) {
  switch (category) {
    case "agent":
      return "Agent";
    case "ai":
      return "AI";
    case "sandbox":
      return "Sandbox";
  }
}

function getSpanCategoryClass(category: OrganizationTraceSpan["category"]) {
  switch (category) {
    case "agent":
      return "bg-violet-500";
    case "ai":
      return "bg-cyan-500";
    case "sandbox":
      return "bg-amber-500";
  }
}

function getSpanBarStyle(span: OrganizationTraceSpan, traceDurationMs: number) {
  const total = Math.max(traceDurationMs, 1);
  const left = Math.min(Math.max((span.offsetMs / total) * 100, 0), 99.5);
  const width = Math.max((span.durationMs / total) * 100, 0.45);

  return {
    left: `${left}%`,
    width: `${Math.min(width, 100 - left)}%`,
  };
}

function getChildCounts(spans: OrganizationTraceSpan[]) {
  const childCounts = new Map<string, number>();
  for (const span of spans) {
    if (!span.parentSpanId) {
      continue;
    }

    childCounts.set(
      span.parentSpanId,
      (childCounts.get(span.parentSpanId) ?? 0) + 1,
    );
  }
  return childCounts;
}

function getVisibleSpans(
  spans: OrganizationTraceSpan[],
  collapsedSpanIds: Set<string>,
) {
  const spansById = new Map(spans.map((span) => [span.spanId, span]));
  const visibleSpans: OrganizationTraceSpan[] = [];

  for (const span of spans) {
    let parentId = span.parentSpanId;
    const seen = new Set<string>();
    let hidden = false;
    while (parentId && !seen.has(parentId)) {
      if (collapsedSpanIds.has(parentId)) {
        hidden = true;
        break;
      }

      seen.add(parentId);
      parentId = spansById.get(parentId)?.parentSpanId ?? null;
    }

    if (!hidden) {
      visibleSpans.push(span);
    }
  }

  return visibleSpans;
}

function TraceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function TraceMetadata({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">
        {value ?? "unknown"}
      </div>
    </div>
  );
}

function TraceSummary({
  trace,
  traces,
  onSelectRepo,
  onSelectTrace,
}: {
  trace: OrganizationSessionTrace;
  traces: OrganizationSessionTrace[];
  onSelectRepo: (repoKey: string) => void;
  onSelectTrace: (traceId: string) => void;
}) {
  const selectedRepoKey = getRepoKey(trace);
  const repoOptions = useMemo(() => getRepoOptions(traces), [traces]);
  const sessionOptions = useMemo(
    () =>
      traces.filter((candidate) => getRepoKey(candidate) === selectedRepoKey),
    [selectedRepoKey, traces],
  );
  const user = trace.username ?? trace.userId;

  return (
    <div className="rounded-md border border-border/50 bg-background">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)]">
          <div className="min-w-0 space-y-1.5">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="trace-repository"
            >
              Repository
            </label>
            <Select value={selectedRepoKey} onValueChange={onSelectRepo}>
              <SelectTrigger id="trace-repository" className="w-full">
                <SelectValue placeholder="Select repository" />
              </SelectTrigger>
              <SelectContent>
                {repoOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="trace-session"
            >
              Session
            </label>
            <Select value={trace.traceId} onValueChange={onSelectTrace}>
              <SelectTrigger id="trace-session" className="w-full">
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                {sessionOptions.map((option) => (
                  <SelectItem key={option.traceId} value={option.traceId}>
                    <span className="block truncate">
                      {getTraceTitle(option)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="grid gap-4 px-4 py-3 md:grid-cols-3 xl:grid-cols-6">
        <TraceMetadata label="Session" value={trace.sessionId} />
        <TraceMetadata label="Trace" value={trace.traceId} />
        <TraceMetadata label="Sandbox" value={trace.sandboxName} />
        <TraceMetadata label="User" value={user} />
        <TraceMetadata label="Workflow" value={trace.workflowRunId} />
        <TraceMetadata
          label="Started"
          value={formatDateTime(trace.startedAt)}
        />
      </div>
      <div className="grid gap-2 border-t border-border/50 px-4 py-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <TraceStat label="Duration" value={formatDuration(trace.durationMs)} />
        <TraceStat label="Spans" value={trace.spanCount.toLocaleString()} />
        <TraceStat
          label="Commands"
          value={trace.commandCount.toLocaleString()}
        />
        <TraceStat label="Errors" value={trace.errorCount.toLocaleString()} />
      </div>
    </div>
  );
}

function TraceRuler({ durationMs }: { durationMs: number }) {
  return (
    <div className="relative h-8">
      {RULER_TICKS.map((tick) => (
        <div
          key={tick}
          className="absolute top-0 h-full border-l border-border/60"
          style={{ left: `${tick}%` }}
        >
          <span
            className={cn(
              "absolute top-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground",
              tick === 100 ? "-translate-x-full" : "translate-x-1",
            )}
          >
            {formatDuration((durationMs * tick) / 100)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TraceSpanRow({
  childCount,
  collapsed,
  durationMs,
  span,
  onToggle,
}: {
  childCount: number;
  collapsed: boolean;
  durationMs: number;
  span: OrganizationTraceSpan;
  onToggle: () => void;
}) {
  return (
    <div className="grid min-h-12 grid-cols-[minmax(360px,0.95fr)_minmax(520px,1.05fr)] border-b border-border/40 last:border-b-0">
      <div className="min-w-0 border-r border-border/50 px-3 py-2">
        <div
          className="flex min-w-0 items-start gap-2"
          style={{ paddingLeft: `${Math.min(span.depth, 10) * 16}px` }}
        >
          {childCount > 0 ? (
            <button
              type="button"
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={collapsed ? "Expand span" : "Collapse span"}
              onClick={onToggle}
            >
              {collapsed ? (
                <ChevronRight className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </button>
          ) : (
            <span className="mt-0.5 size-4 shrink-0" />
          )}
          <span
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              span.error
                ? "bg-destructive"
                : getSpanCategoryClass(span.category),
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-medium">{span.name}</span>
              <span className="rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {getSpanCategoryLabel(span.category)}
              </span>
              {span.statusCode && span.statusCode !== "UNSET" ? (
                <span
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 text-[10px] uppercase",
                    span.error
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {span.statusCode}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
              {getSpanRowLabel(span)}
            </span>
          </span>
        </div>
      </div>
      <div className="relative min-w-0 px-3 py-2">
        {RULER_TICKS.map((tick) => (
          <span
            key={tick}
            className="absolute top-0 bottom-0 border-l border-border/40"
            style={{ left: `calc(${tick}% + 0.75rem)` }}
          />
        ))}
        <div className="relative h-7 rounded-sm bg-muted/30">
          <div
            className={cn(
              "absolute top-1/2 h-3 -translate-y-1/2 rounded-sm",
              span.error
                ? "bg-destructive"
                : getSpanCategoryClass(span.category),
            )}
            style={getSpanBarStyle(span, durationMs)}
            title={`${span.name} ${formatDuration(span.durationMs)}`}
          />
        </div>
        <div className="mt-1 flex justify-between gap-3 font-mono text-[11px] text-muted-foreground">
          <span>{formatDuration(span.offsetMs)}</span>
          <span>{formatDuration(span.durationMs)}</span>
        </div>
      </div>
    </div>
  );
}

function TraceWaterfall({ trace }: { trace: OrganizationSessionTrace }) {
  const [collapsedSpanIds, setCollapsedSpanIds] = useState<Set<string>>(
    () => new Set(),
  );
  const durationMs = Math.max(
    trace.durationMs,
    ...trace.spans.map((span) => span.offsetMs + span.durationMs),
    1,
  );
  const childCounts = useMemo(() => getChildCounts(trace.spans), [trace.spans]);
  const visibleSpans = useMemo(
    () => getVisibleSpans(trace.spans, collapsedSpanIds),
    [collapsedSpanIds, trace.spans],
  );

  function toggleSpan(spanId: string) {
    setCollapsedSpanIds((current) => {
      const next = new Set(current);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-md border border-border/50 bg-background">
      <div className="grid min-w-[980px] grid-cols-[minmax(360px,0.95fr)_minmax(520px,1.05fr)] border-b border-border/50 bg-muted/20">
        <div className="border-r border-border/50 px-3 py-2 text-xs font-medium text-muted-foreground">
          Service & operation
        </div>
        <div className="px-3 py-2">
          <TraceRuler durationMs={durationMs} />
        </div>
      </div>
      <div className="max-h-[680px] min-w-[980px] overflow-y-auto">
        {visibleSpans.map((span) => {
          const childCount = childCounts.get(span.spanId) ?? 0;
          const collapsed = collapsedSpanIds.has(span.spanId);
          return (
            <TraceSpanRow
              key={span.spanId}
              childCount={childCount}
              collapsed={collapsed}
              durationMs={durationMs}
              span={span}
              onToggle={() => toggleSpan(span.spanId)}
            />
          );
        })}
      </div>
    </div>
  );
}

function TraceDetail({
  trace,
  traces,
  onSelectRepo,
  onSelectTrace,
}: {
  trace: OrganizationSessionTrace | null;
  traces: OrganizationSessionTrace[];
  onSelectRepo: (repoKey: string) => void;
  onSelectTrace: (traceId: string) => void;
}) {
  if (!trace) {
    return (
      <div className="rounded-md border border-border/50 bg-muted/10 p-4 text-sm text-muted-foreground">
        Open a session from Analytics to inspect spans.
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <TraceSummary
        trace={trace}
        traces={traces}
        onSelectRepo={onSelectRepo}
        onSelectTrace={onSelectTrace}
      />
      <div className="overflow-x-auto">
        <TraceWaterfall key={trace.traceId} trace={trace} />
      </div>
    </div>
  );
}

export function TracingSectionSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-36 rounded-md" />
      <Skeleton className="h-[520px] rounded-md" />
    </div>
  );
}

export function TracingSection({ traceId }: { traceId: string | null }) {
  const router = useRouter();
  const { data, error, isLoading } = useSWR<OrganizationTracingResponse>(
    TRACING_PATH,
    fetcher,
  );
  const organization = data?.organization ?? null;
  const traces = organization?.traces ?? EMPTY_TRACES;
  const selectedTrace = useMemo(
    () =>
      traceId
        ? (traces.find((trace) => trace.traceId === traceId) ?? null)
        : (traces[0] ?? null),
    [traceId, traces],
  );

  function navigateToTrace(nextTraceId: string) {
    router.push(`/settings/tracing?traceId=${encodeURIComponent(nextTraceId)}`);
  }

  function navigateToRepo(repoKey: string) {
    const nextTrace = traces.find((trace) => getRepoKey(trace) === repoKey);
    if (nextTrace) {
      navigateToTrace(nextTrace.traceId);
    }
  }

  if (isLoading) {
    return <TracingSectionSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-md border border-border/50 bg-muted/10 p-4 text-sm text-muted-foreground">
        Failed to load organization traces.
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="rounded-md border border-border/50 bg-muted/10 p-4 text-sm text-muted-foreground">
        Tracing is available for verified organization email domains.
      </div>
    );
  }

  return (
    <TraceDetail
      trace={selectedTrace}
      traces={traces}
      onSelectRepo={navigateToRepo}
      onSelectTrace={navigateToTrace}
    />
  );
}
