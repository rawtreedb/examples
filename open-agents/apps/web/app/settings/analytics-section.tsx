"use client";

import { formatTokens } from "@open-agents/shared";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import useSWR from "swr";
import { ContributionChart } from "@/components/contribution-chart";
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
import {
  LeaderboardSection,
  LeaderboardSectionSkeleton,
} from "./leaderboard-section";

interface OrganizationUsageDay {
  activeUserCount: number;
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
  sessionTitle: string | null;
  spanCount: number;
  startedAt: string | null;
  traceId: string;
  userId: string | null;
  username: string | null;
  workflowRunId: string | null;
}

interface OrganizationAnalytics {
  domain: string;
  repositories: OrganizationRepositoryInsight[];
  sandboxTraces: OrganizationSessionTrace[];
  source: "rawtree";
  usage: OrganizationUsageDay[];
  users: OrganizationUsageUser[];
}

interface OrganizationAnalyticsResponse {
  organization: OrganizationAnalytics | null;
}

const EMPTY_USAGE: OrganizationUsageDay[] = [];
const ACTIVITY_CHART_WEEKS = 53;

function buildAnalyticsPath(range: DateRange | undefined): string {
  const query = new URLSearchParams();

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
    return "activity over the past year.";
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
    ? `showing ${fromLabel}.`
    : `showing ${fromLabel} to ${toLabel}.`;
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

  return `${(durationMs / 60_000).toFixed(1)}m`;
}

function formatShortDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

function getSessionLabel(trace: OrganizationSessionTrace): string {
  if (trace.sessionTitle) {
    return trace.sessionTitle;
  }

  if (trace.sessionId) {
    return `Session ${formatTraceId(trace.sessionId)}`;
  }

  return `Trace ${formatTraceId(trace.traceId)}`;
}

function getRepoLabel(trace: OrganizationSessionTrace): string {
  return trace.repoOwner && trace.repoName
    ? `${trace.repoOwner}/${trace.repoName}`
    : "No repo";
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

function getActiveUserChartPath(
  rows: OrganizationUsageDay[],
  width: number,
  height: number,
  padding: { bottom: number; left: number; right: number; top: number },
): string {
  const maxUsers = Math.max(...rows.map((row) => row.activeUserCount), 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  return rows
    .map((row, index) => {
      const x =
        padding.left +
        (rows.length === 1
          ? plotWidth
          : (index / (rows.length - 1)) * plotWidth);
      const y =
        padding.top +
        plotHeight -
        (row.activeUserCount / maxUsers) * plotHeight;

      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function ActiveUsersSection({ usage }: { usage: OrganizationUsageDay[] }) {
  const rows = usage.filter((row) => row.activeUserCount > 0);
  const maxUsers = Math.max(...rows.map((row) => row.activeUserCount), 0);
  const latest = rows.at(-1);
  const first = rows[0];
  const width = 640;
  const height = 180;
  const padding = { bottom: 26, left: 34, right: 18, top: 18 };
  const path =
    rows.length > 0 ? getActiveUserChartPath(rows, width, height, padding) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active users</CardTitle>
        <CardDescription>
          Daily active users in the selected activity window.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active users in this period.
          </p>
        ) : (
          <div className="rounded-lg border border-border/50 bg-muted/10 p-4">
            <div className="mb-3 grid gap-3 min-[420px]:grid-cols-3">
              <StatBlock
                label="Latest"
                value={(latest?.activeUserCount ?? 0).toLocaleString()}
                detail={latest ? formatShortDate(latest.date) : undefined}
              />
              <StatBlock
                label="Peak"
                value={maxUsers.toLocaleString()}
                detail="Daily active users"
              />
              <StatBlock
                label="Active days"
                value={rows.length.toLocaleString()}
                detail={
                  first && latest
                    ? `${formatShortDate(first.date)} to ${formatShortDate(latest.date)}`
                    : undefined
                }
              />
            </div>
            <div className="overflow-x-auto">
              <svg
                aria-label="Daily active users line chart"
                className="h-48 min-w-[560px] w-full"
                preserveAspectRatio="none"
                role="img"
                viewBox={`0 0 ${width} ${height}`}
              >
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={height - padding.bottom}
                  y2={height - padding.bottom}
                  className="stroke-border"
                />
                <line
                  x1={padding.left}
                  x2={padding.left}
                  y1={padding.top}
                  y2={height - padding.bottom}
                  className="stroke-border"
                />
                {[0.25, 0.5, 0.75, 1].map((tick) => {
                  const y =
                    padding.top +
                    (height - padding.top - padding.bottom) * (1 - tick);
                  return (
                    <line
                      key={tick}
                      x1={padding.left}
                      x2={width - padding.right}
                      y1={y}
                      y2={y}
                      className="stroke-border/60"
                      strokeDasharray="4 6"
                    />
                  );
                })}
                <path
                  d={path}
                  className="fill-none stroke-foreground"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                />
                {rows.map((row, index) => {
                  const plotWidth = width - padding.left - padding.right;
                  const plotHeight = height - padding.top - padding.bottom;
                  const x =
                    padding.left +
                    (rows.length === 1
                      ? plotWidth
                      : (index / (rows.length - 1)) * plotWidth);
                  const y =
                    padding.top +
                    plotHeight -
                    (row.activeUserCount / Math.max(maxUsers, 1)) * plotHeight;

                  return (
                    <circle
                      key={row.date}
                      cx={x}
                      cy={y}
                      r={index === rows.length - 1 ? 4 : 2.5}
                      className="fill-background stroke-foreground"
                      strokeWidth="2"
                    >
                      <title>
                        {formatShortDate(row.date)}:{" "}
                        {row.activeUserCount.toLocaleString()} active users
                      </title>
                    </circle>
                  );
                })}
                <text
                  x={padding.left}
                  y={height - 6}
                  className="fill-muted-foreground text-[11px]"
                >
                  {first ? formatShortDate(first.date) : ""}
                </text>
                <text
                  textAnchor="end"
                  x={width - padding.right}
                  y={height - 6}
                  className="fill-muted-foreground text-[11px]"
                >
                  {latest ? formatShortDate(latest.date) : ""}
                </text>
                <text
                  x={4}
                  y={padding.top + 4}
                  className="fill-muted-foreground text-[11px]"
                >
                  {maxUsers.toLocaleString()}
                </text>
              </svg>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
        <CardTitle>Edits by Repository</CardTitle>
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

function SessionTracesSection({
  traces,
}: {
  traces: OrganizationSessionTrace[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>
          Recent traced agent sessions. Open a row to inspect the full trace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {traces.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No session traces in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/50 bg-muted/10">
            <div className="min-w-[940px]">
              <div className="grid grid-cols-[150px_minmax(220px,1.35fr)_minmax(180px,1fr)_90px_90px_80px_80px_90px] border-b border-border/50 px-4 py-3 text-xs font-medium text-muted-foreground">
                <div>Date</div>
                <div>Session</div>
                <div>Repository</div>
                <div className="text-right">Commands</div>
                <div className="text-right">AI spans</div>
                <div className="text-right">Spans</div>
                <div className="text-right">Errors</div>
                <div className="text-right">Duration</div>
              </div>
              <div className="divide-y divide-border/40">
                {traces.map((trace) => (
                  <Link
                    key={trace.traceId}
                    href={`/settings/tracing?traceId=${encodeURIComponent(trace.traceId)}`}
                    className="grid grid-cols-[150px_minmax(220px,1.35fr)_minmax(180px,1fr)_90px_90px_80px_80px_90px] items-center px-4 py-3 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="font-mono text-xs text-muted-foreground">
                      {formatDateTime(trace.startedAt ?? trace.lastSeenAt)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {getSessionLabel(trace)}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {trace.username ?? trace.userId ?? "unknown user"}
                      </div>
                    </div>
                    <div className="min-w-0 truncate text-muted-foreground">
                      {getRepoLabel(trace)}
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      {trace.commandCount.toLocaleString()}
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      {trace.aiSpanCount.toLocaleString()}
                    </div>
                    <div className="text-right font-mono tabular-nums text-muted-foreground">
                      {trace.spanCount.toLocaleString()}
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      {trace.errorCount.toLocaleString()}
                    </div>
                    <div className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatDuration(trace.durationMs)}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalyticsSection() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const fullPath = useMemo(() => buildAnalyticsPath(undefined), []);
  const filteredPath = useMemo(
    () => (dateRange?.from ? buildAnalyticsPath(dateRange) : null),
    [dateRange],
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
  const userCount = organization?.users.length ?? 0;
  if (isLoading) {
    return <AnalyticsSectionSkeleton />;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Failed to load activity.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!organization) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Activity is available for verified organization email domains.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Activity</CardTitle>
              <CardDescription>
                @{organization.domain} {formatDateRangeLabel(dateRange)}
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
              value={userCount.toLocaleString()}
              detail="Active organization users"
            />
          </div>

          <ContributionChart
            data={chartUsage}
            selectedRange={dateRange}
            onSelectRange={setDateRange}
            weeks={ACTIVITY_CHART_WEEKS}
          />
        </CardContent>
      </Card>
      <ActiveUsersSection usage={activeUsage} />
      <Card>
        <CardContent>
          <LeaderboardSection />
        </CardContent>
      </Card>
      <RepositoryEditsSection repositories={activeRepositories} />
      <SessionTracesSection traces={activeSessionTraces} />
    </div>
  );
}
