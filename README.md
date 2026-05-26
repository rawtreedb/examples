# RawTree Examples

Examples for sending agent and sandbox telemetry to RawTree.

## Examples

### `sandboxes/vercel-ai-sandbox.ts`

Minimal TypeScript script that sends OpenTelemetry traces from a Vercel Sandbox
agent run to RawTree with the `otlp-traces` transform.

The demo uses:

- OpenTelemetry Node SDK and OTLP HTTP exporter for trace export
- `@vercel/sandbox` for the full VM sandbox
- `bash-tool` for the AI SDK bash/read/write toolset
- `@rawtree/sdk` to query the ingested trace rows after the run
- A terminal trace renderer that groups spans by `traceId` and `parentSpanId`

### `open-agents/`

Vendored copy of `vercel-labs/open-agents` for adapting its agent metrics,
user-facing activity, and leaderboard surfaces to RawTree. See
`open-agents/RAWTREE.md` for source provenance and adaptation notes.

## Setup

`.env.local` already needs:

```sh
RAWTREE_API_KEY=...
```

Add one model credential path:

```sh
OPENAI_API_KEY=...
# or
AI_GATEWAY_API_KEY=...
AI_MODEL=openai/gpt-5
```

The Vercel Sandbox SDK also needs local Vercel project auth, typically from:

```sh
vercel link
vercel env pull .env.local
```

## Run

```sh
npm install
npm run sandboxes:vercel-ai
```

The script prints the generated `run_id` and `trace_id`, runs the agent, flushes
traces to RawTree, then queries `agent_sandbox_traces` for the full trace and
prints a terminal timeline.

Example shape:

```text
RawTree trace timeline
trace_id  ...
run_id    ...
table     agent_sandbox_traces
spans     12 | duration 4.00s | service rawtree-vercel-ai-sandbox

 +0.00ms    4.00s OK demo.run INTERNAL
    |-- +100.0ms  700.0ms OK sandbox.create INTERNAL
    |   provider=vercel  runtime=node24  sandbox=...
    `--   +1.00s  800.0ms OK ai.toolCall INTERNAL
        operation=ai.toolCall  scope=ai  tool=bash
        `--   +1.10s  500.0ms OK sandbox.bash INTERNAL
            command=node -e "..."  exit=0  stdout_bytes=23
```

The example declares the trace service and destination table in code:

```ts
const telemetry = registerRawTreeOtel({
  serviceName: "rawtree-vercel-ai-sandbox",
  tableName: "agent_sandbox_traces",
});
```

## TypeScript

The runnable sandbox example lives in `sandboxes/vercel-ai-sandbox.ts`. Shared
OpenTelemetry setup lives in `lib/register-otel.ts`. It exports
`registerRawTreeOtel`, a generic Node OpenTelemetry registration helper that
sends OTLP traces to RawTree's `otlp-traces` transform.

The reusable terminal renderer lives in `lib/trace-timeline.ts`.

```sh
npm run check
```
