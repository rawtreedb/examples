import { Daytona } from "@daytona/sdk";

const daytonaApiKey = process.env.DAYTONA_API_KEY;
const rawtreeApiKey = process.env.RAWTREE_API_KEY;

if (!daytonaApiKey) {
  throw new Error("Set DAYTONA_API_KEY before running the example.");
}

if (!rawtreeApiKey) {
  throw new Error("Set RAWTREE_API_KEY before running the example.");
}

process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://api.rawtree.com/otlp";
process.env.OTEL_EXPORTER_OTLP_HEADERS = `Authorization=Bearer ${rawtreeApiKey}`;

const daytona = new Daytona({
  apiKey: daytonaApiKey,
  otelEnabled: true,
});

let sandbox: Awaited<ReturnType<typeof daytona.create>> | undefined;

try {
  sandbox = await daytona.create({
    language: "typescript",
  });

  const response = await sandbox.process.codeRun(
    'console.log("Hello World from Daytona!")',
  );

  console.log(response.result);
} finally {
  if (sandbox) {
    await daytona.delete(sandbox);
  }

  await daytona[Symbol.asyncDispose]();
}
