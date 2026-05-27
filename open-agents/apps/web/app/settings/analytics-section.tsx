"use client";

import { formatTokens } from "@open-agents/shared";
import { ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import useSWR from "swr";
import { ContributionChart } from "@/components/contribution-chart";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetcher } from "@/lib/swr";
import { formatDateOnly } from "@/lib/usage/date-range";
import { cn } from "@/lib/utils";
import {
  LeaderboardSection,
  LeaderboardSectionSkeleton,
} from "./leaderboard-section";

interface OrganizationUsageDay {
  cachedInputTokens: number;
  date: string;
  inputTokens: number;
  messageCount: number;
  outputTokens: number;
  toolCallCount: number;
}

interface OrganizationUsageUser {
  avatarUrl: string | null;
  lastSeenAt: string | null;
  messageCount: number;
  name: string | null;
  totalTokens: number;
  userId: string;
  username: string;
}

interface OrganizationRepositoryInsight {
  linesAdded: number;
  linesRemoved: number;
  repoName: string;
  repoOwner: string;
  sessionCount: number;
  totalLinesChanged: number;
  trackedPrCount: number;
}

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

interface OrganizationAnalytics {
  domain: string;
  rawTreeAvailable: boolean;
  repositories: OrganizationRepositoryInsight[];
  sandboxTraces: OrganizationSessionTrace[];
  selectedUserIds: string[];
  source: "rawtree";
  usage: OrganizationUsageDay[];
  users: OrganizationUsageUser[];
}

interface OrganizationAnalyticsResponse {
  organization: OrganizationAnalytics | null;
}

const EMPTY_USAGE: OrganizationUsageDay[] = [];

function buildAnalyticsPath(
  userIds: string[],
  range: DateRange | undefined,
): string {
  const query = new URLSearchParams();
  for (const userId of userIds) {
    query.append("userId", userId);
  }

  if (range?.from) {
    query.set("from", formatDateOnly(range.from));
    query.set("to", formatDateOnly(range.to ?? range.from));
  }

  const queryString = query.toString();
  return queryString
    ? `/api/analytics/organization?${queryString}`
    : "/api/analytics/organization";
}

function formatDateRangeLabel(range: DateRange | undefined): string {
  if (!range?.from) {
    return "Organization activity over the past 39 weeks.";
  }

  const fromLabel = range.from.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const toDate = range.to ?? range.from;
  const toLabel = toDate.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return fromLabel === toLabel
    ? `Showing ${fromLabel}.`
    : `Showing ${fromLabel} to ${toLabel}.`;
}

function getInitials(user: OrganizationUsageUser): string {
  const label = user.name || user.username || user.userId;
  return label
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function sumRows(rows: OrganizationUsageDay[]) {
  return rows.reduce(
    (acc, row) => ({
      cachedInputTokens: acc.cachedInputTokens + row.cachedInputTokens,
      inputTokens: acc.inputTokens + row.inputTokens,
      messageCount: acc.messageCount + row.messageCount,
      outputTokens: acc.outputTokens + row.outputTokens,
      toolCallCount: acc.toolCallCount + row.toolCallCount,
    }),
    {
      cachedInputTokens: 0,
      inputTokens: 0,
      messageCount: 0,
      outputTokens: 0,
      toolCallCount: 0,
    },
  );
}

export function AnalyticsSectionSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[120px] rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12 rounded-md" />
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <LeaderboardSectionSkeleton />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 rounded-md" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-44 rounded-md" />
        </CardContent>
      </Card>
    </div>
  );
}

function StatBlock({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/50 bg-muted/20 p-3 sm:p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-lg font-semibold leading-tight sm:text-xl">
        {value}
      </div>
      {detail ? (
        <div className="mt-1 text-xs leading-snug text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function UserFilter({
  selectedUserIds,
  users,
  onChange,
}: {
  selectedUserIds: string[];
  users: OrganizationUsageUser[];
  onChange: (nextUserIds: string[]) => void;
}) {
  const selected = new Set(selectedUserIds);

  function toggleUser(userId: string) {
    const next = new Set(selected);
    if (next.has(userId)) {
      next.delete(userId);
    } else {
      next.add(userId);
    }
    onChange([...next]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Users</h3>
        {selectedUserIds.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-0 text-muted-foreground"
            onClick={() => onChange([])}
          >
            Clear filter
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {users.map((user) => {
          const isSelected = selected.has(user.userId);
          return (
            <label
              key={user.userId}
              className="flex min-w-0 items-center gap-3 rounded-md border border-border/50 bg-muted/10 px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-foreground"
                checked={isSelected}
                onChange={() => toggleUser(user.userId)}
              />
              <Avatar className="size-8 text-xs">
                {user.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt={user.username} />
                ) : null}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {user.name || user.username}
                </span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {formatTokens(user.totalTokens)} tokens
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function RepositoryEditsSection({
  repositories,
}: {
  repositories: OrganizationRepositoryInsight[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Edits by Repository</CardTitle>
        <CardDescription>
          Ranked by lines changed across organization sessions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repository edits in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/50 bg-muted/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead className="text-right">Changed</TableHead>
                  <TableHead className="text-right">Added</TableHead>
                  <TableHead className="text-right">Removed</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Sessions
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    PRs
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repositories.map((repo) => (
                  <TableRow key={`${repo.repoOwner}/${repo.repoName}`}>
                    <TableCell className="max-w-[220px]">
                      <div className="truncate font-medium">
                        {repo.repoOwner}/{repo.repoName}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {repo.totalLinesChanged.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {repo.linesAdded.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {repo.linesRemoved.toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                      {repo.sessionCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                      {repo.trackedPrCount.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "unknown";
  }

  return new Date(value).toLocaleTimeString("en-US", {
    fractionalSecondDigits: 3,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getSpanBarStyle(span: OrganizationTraceSpan, traceDurationMs: number) {
  const total = Math.max(traceDurationMs, 1);
  const left = Math.min(Math.max((span.offsetMs / total) * 100, 0), 99.5);
  const width = Math.max((span.durationMs / total) * 100, 0.5);

  return {
    left: `${left}%`,
    width: `${Math.min(width, 100 - left)}%`,
  };
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
      return "bg-fuchsia-500";
    case "sandbox":
      return "bg-amber-500";
  }
}

function getSpanRowLabel(span: OrganizationTraceSpan): string {
  if (span.detail && span.detail !== span.name) {
    return span.detail;
  }

  return span.name;
}

function SessionTraceSection({
  traces,
}: {
  traces: OrganizationSessionTrace[];
}) {
  const [expandedTraceIds, setExpandedTraceIds] = useState<Set<string>>(
    () => new Set(),
  );

  function toggleTrace(traceId: string) {
    setExpandedTraceIds((current) => {
      const next = new Set(current);
      if (next.has(traceId)) {
        next.delete(traceId);
      } else {
        next.add(traceId);
      }
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session Activity</CardTitle>
        <CardDescription>
          Agent steps, AI SDK spans, sandbox runtimes, and commands grouped by
          session trace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {traces.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No session activity spans in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/50 bg-muted/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trace</TableHead>
                  <TableHead>Runtime</TableHead>
                  <TableHead className="hidden sm:table-cell">Repo</TableHead>
                  <TableHead className="text-right">Commands</TableHead>
                  <TableHead className="text-right">AI spans</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Spans
                  </TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    Duration
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traces.map((trace) => {
                  const isExpanded = expandedTraceIds.has(trace.traceId);
                  return (
                    <Fragment key={trace.traceId}>
                      <TableRow
                        data-state={isExpanded ? "selected" : undefined}
                      >
                        <TableCell className="min-w-[190px]">
                          <button
                            type="button"
                            className="flex min-w-0 items-start gap-2 text-left"
                            onClick={() => toggleTrace(trace.traceId)}
                            aria-expanded={isExpanded}
                          >
                            <ChevronRight
                              className={cn(
                                "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
                                isExpanded && "rotate-90",
                              )}
                            />
                            <span className="min-w-0">
                              <span className="block font-mono text-xs font-medium">
                                {formatTraceId(trace.traceId)}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {formatDateTime(trace.lastSeenAt)}
                              </span>
                            </span>
                          </button>
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          <div className="truncate font-medium">
                            {trace.sandboxName ?? "unknown"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {trace.workflowRunId
                              ? `workflow ${formatTraceId(trace.workflowRunId)}`
                              : (trace.username ??
                                trace.userId ??
                                "unknown user")}
                          </div>
                        </TableCell>
                        <TableCell className="hidden max-w-[180px] truncate sm:table-cell">
                          {trace.repoOwner && trace.repoName
                            ? `${trace.repoOwner}/${trace.repoName}`
                            : "No repo"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {trace.commandCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {trace.aiSpanCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                          {trace.spanCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {trace.errorCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                          {formatDuration(trace.durationMs)}
                        </TableCell>
                      </TableRow>
                      {isExpanded ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={8}
                            className="whitespace-normal bg-background p-0"
                          >
                            <TraceWaterfall trace={trace} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TraceWaterfall({ trace }: { trace: OrganizationSessionTrace }) {
  const totalDurationMs = Math.max(
    trace.durationMs,
    ...trace.spans.map((span) => span.offsetMs + span.durationMs),
    1,
  );

  return (
    <div className="border-t border-border/50 bg-muted/5 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="min-w-0">
          <div className="font-medium text-foreground">Trace timeline</div>
          <div className="mt-0.5 truncate font-mono">
            {formatTimestamp(trace.startedAt)} to{" "}
            {formatTimestamp(trace.lastSeenAt)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>{trace.spans.length.toLocaleString()} spans</span>
          <span>{formatDuration(totalDurationMs)} total</span>
        </div>
      </div>

      {trace.spans.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No span detail is available for this trace.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-md border border-border/50 bg-background">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(300px,0.9fr)_minmax(360px,1.1fr)] border-b border-border/50 bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">
              <div>Span</div>
              <div className="grid grid-cols-3 font-mono tabular-nums">
                <span>0ms</span>
                <span className="text-center">
                  {formatDuration(totalDurationMs / 2)}
                </span>
                <span className="text-right">
                  {formatDuration(totalDurationMs)}
                </span>
              </div>
            </div>

            <div className="divide-y divide-border/40">
              {trace.spans.map((span, index) => {
                const label = getSpanRowLabel(span);
                return (
                  <div
                    key={`${span.spanId}-${index}`}
                    className="grid grid-cols-[minmax(300px,0.9fr)_minmax(360px,1.1fr)] items-center gap-3 px-3 py-2"
                  >
                    <div
                      className="min-w-0"
                      style={{
                        paddingLeft: `${Math.min(span.depth, 8) * 14}px`,
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            span.error
                              ? "bg-destructive"
                              : getSpanCategoryClass(span.category),
                          )}
                        />
                        <span className="truncate text-sm font-medium">
                          {span.name}
                        </span>
                        <span className="shrink-0 rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-normal text-muted-foreground">
                          {getSpanCategoryLabel(span.category)}
                        </span>
                        {span.statusCode && span.statusCode !== "UNSET" ? (
                          <span
                            className={cn(
                              "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-normal",
                              span.error
                                ? "bg-destructive/10 text-destructive"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {span.statusCode}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {label}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="relative h-7 rounded-sm bg-muted/40">
                        <div
                          className={cn(
                            "absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full",
                            span.error
                              ? "bg-destructive"
                              : getSpanCategoryClass(span.category),
                          )}
                          style={getSpanBarStyle(span, totalDurationMs)}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[11px] text-muted-foreground">
                        <span>{formatDuration(span.offsetMs)}</span>
                        <span>{formatDuration(span.durationMs)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AnalyticsSection() {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const fullPath = useMemo(
    () => buildAnalyticsPath(selectedUserIds, undefined),
    [selectedUserIds],
  );
  const filteredPath = useMemo(
    () =>
      dateRange?.from ? buildAnalyticsPath(selectedUserIds, dateRange) : null,
    [dateRange, selectedUserIds],
  );

  const {
    data: fullData,
    error: fullError,
    isLoading: isFullLoading,
  } = useSWR<OrganizationAnalyticsResponse>(fullPath, fetcher);
  const {
    data: filteredData,
    error: filteredError,
    isLoading: isFilteredLoading,
  } = useSWR<OrganizationAnalyticsResponse>(filteredPath, fetcher);

  const response = filteredPath ? filteredData : fullData;
  const organization = response?.organization ?? fullData?.organization ?? null;
  const activeUsage =
    response?.organization?.usage ?? organization?.usage ?? EMPTY_USAGE;
  const activeRepositories =
    response?.organization?.repositories ?? organization?.repositories ?? [];
  const activeSessionTraces =
    response?.organization?.sandboxTraces ?? organization?.sandboxTraces ?? [];
  const chartUsage = fullData?.organization?.usage ?? activeUsage;
  const isLoading =
    isFullLoading || (filteredPath !== null && isFilteredLoading);
  const error = fullError ?? filteredError;

  const totals = useMemo(() => sumRows(activeUsage), [activeUsage]);
  const totalTokens = totals.inputTokens + totals.outputTokens;
  const selectedUserCount =
    selectedUserIds.length > 0
      ? selectedUserIds.length
      : (organization?.users.length ?? 0);

  if (isLoading) {
    return <AnalyticsSectionSkeleton />;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Failed to load organization analytics.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!organization) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Organization analytics are available for verified organization email
            domains.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!organization.rawTreeAvailable) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Organization analytics</CardTitle>
            <CardDescription>@{organization.domain}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              RawTree usage data is not available yet.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <LeaderboardSection />
          </CardContent>
        </Card>
        <RepositoryEditsSection repositories={activeRepositories} />
        <SessionTraceSection traces={activeSessionTraces} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Organization analytics</CardTitle>
              <CardDescription>
                @{organization.domain} · {formatDateRangeLabel(dateRange)}
              </CardDescription>
            </div>
            {dateRange?.from ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start px-0 text-muted-foreground"
                onClick={() => setDateRange(undefined)}
              >
                Clear date
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            <StatBlock label="Total tokens" value={formatTokens(totalTokens)} />
            <StatBlock
              label="Messages"
              value={totals.messageCount.toLocaleString()}
            />
            <StatBlock
              label="Tool calls"
              value={totals.toolCallCount.toLocaleString()}
            />
            <StatBlock
              label="Users"
              value={selectedUserCount.toLocaleString()}
              detail={
                selectedUserIds.length > 0
                  ? "Selected users"
                  : "Active organization users"
              }
            />
          </div>

          <ContributionChart
            data={chartUsage}
            selectedRange={dateRange}
            onSelectRange={setDateRange}
          />

          {organization.users.length > 0 ? (
            <UserFilter
              selectedUserIds={selectedUserIds}
              users={organization.users}
              onChange={(nextUserIds) => {
                setSelectedUserIds(nextUserIds);
                setDateRange(undefined);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No organization users have usage in this period.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <LeaderboardSection />
        </CardContent>
      </Card>
      <RepositoryEditsSection repositories={activeRepositories} />
      <SessionTraceSection traces={activeSessionTraces} />
    </div>
  );
}
