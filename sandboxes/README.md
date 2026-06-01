# Sandbox Examples

## `vercel-ai-sandbox.ts`

Runs an AI SDK agent with `bash-tool` inside Vercel Sandbox and exports traces to
RawTree through the `otlp-traces` transform.

```sh
npm run sandboxes:vercel-ai
```

## `daytona.ts`

Creates a Daytona TypeScript sandbox, runs a small code snippet, and exports the
Daytona SDK's native OpenTelemetry traces to RawTree's OTLP endpoint.

Required environment variables:

```sh
DAYTONA_API_KEY=...
RAWTREE_API_KEY=...
```

Optional:

```sh
RAWTREE_TRACES_TABLE=daytona_traces
RAWTREE_OTLP_ENDPOINT=https://api.rawtree.com/otlp
```

```sh
npm run sandboxes:daytona
```
