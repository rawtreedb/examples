# Sandbox Examples

## `vercel-ai-sandbox.ts`

Runs an AI SDK agent with `bash-tool` inside Vercel Sandbox and exports traces to
RawTree through the `otlp-traces` transform.

```sh
npm run sandboxes:vercel-ai
```

## `daytona.ts`

Creates a Daytona TypeScript sandbox, runs a small code snippet, and configures
Daytona SDK native OpenTelemetry traces, metrics, and logs for RawTree's OTLP
endpoint.

Required environment variables:

```sh
DAYTONA_API_KEY=...
RAWTREE_API_KEY=...
```

```sh
npm run sandboxes:daytona
```

## `modal.py`

Runs Modal's hello-world example and relies on Modal's workspace OpenTelemetry
integration to export function logs and metrics to RawTree's default OTLP
tables.

Modal workspace OpenTelemetry settings:

```text
OTLP push URL: https://api.rawtree.com/otlp
Secret: rawtree-otel
Secret key: OTEL_HEADER_Authorization
```

Create the Modal secret with:

```sh
modal secret create rawtree-otel \
  OTEL_HEADER_Authorization="Bearer $RAWTREE_API_KEY"
```

Modal turns secret keys prefixed with `OTEL_HEADER_` into OTLP request headers.
`OTEL_HEADER_Authorization` is sent as the `Authorization` header, so RawTree
receives:

```text
Authorization: Bearer <rawtree api key>
```

```sh
npm run sandboxes:modal
```
