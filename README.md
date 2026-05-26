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

The script prints the generated `run_id`, runs the agent, flushes traces to
RawTree, then queries the latest rows from `agent_sandbox_traces`.

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

```sh
npm run check
```
