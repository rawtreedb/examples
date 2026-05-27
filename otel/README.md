# OpenTelemetry

This folder contains small Node.js OpenTelemetry examples for RawTree.

## Logs

`logs.ts` adapts the PostHog Node.js OpenTelemetry logs setup for RawTree.

The important RawTree log changes are:

- Use a RawTree API key in `RAWTREE_API_KEY`.
- Send OTLP logs to a table insert endpoint:
  `https://api.rawtree.com/v1/tables/otel_logs?transform=otlp-logs`.
- Query the destination table after export.

Run it with:

```sh
npm run otel:logs
```

The example writes to `otel_logs`.

## Traces

`traces.ts` creates a small parent-child span tree, sends it to RawTree, and
prints the queried trace timeline.

The important RawTree trace endpoint is:

```text
https://api.rawtree.com/v1/tables/otel_traces?transform=otlp-traces
```

Run it with:

```sh
npm run otel:traces
```

The example writes to `otel_traces`.

## Setup

Add your RawTree key to `.env.local`:

```sh
RAWTREE_API_KEY=rw_...
```
