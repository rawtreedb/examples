import { randomUUID } from "node:crypto";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SpanStatusCode,
  trace,
  type AttributeValue,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import {
  createBashTool,
  type CommandResult,
  type Sandbox as BashToolSandbox,
} from "bash-tool";
import { RawTree } from "@rawtree/sdk";
import { Sandbox } from "@vercel/sandbox";
import { registerRawTreeOtel } from "../lib/register-otel.js";

type VercelSandbox = Awaited<ReturnType<typeof Sandbox.create>>;
type SpanAttributeInput = Record<string, AttributeValue | undefined>;
type BashCall = {
  command: string;
  span: Span;
};

const serviceName = "rawtree-vercel-ai-sandbox";
const rawtreeTable = "agent_sandbox_traces";
const telemetry = registerRawTreeOtel({
  serviceName,
  tableName: rawtreeTable,
});
const tracer = trace.getTracer(telemetry.serviceName);
const runId = randomUUID();
const modelId =
  process.env.AI_MODEL ??
  process.env.OPENAI_MODEL ??
  (process.env.AI_GATEWAY_API_KEY ? "openai/gpt-5" : "gpt-5");
const model = process.env.AI_GATEWAY_API_KEY ? modelId : openai(modelId);

if (!process.env.AI_GATEWAY_API_KEY) {
  requiredEnv("OPENAI_API_KEY");
}

await withSpan("demo.run", { "demo.run_id": runId }, async (rootSpan) => {
  console.log("run_id:", runId);
  console.log("trace_table:", telemetry.tableName);

  const sandbox = await withSpan(
    "sandbox.create",
    {
      "demo.run_id": runId,
      "sandbox.provider": "vercel",
      "sandbox.runtime": "node24",
    },
    async (span): Promise<VercelSandbox> => {
      const sandbox = await Sandbox.create({
        runtime: "node24",
        timeout: 10 * 60 * 1000,
      });
      const session = sandbox.currentSession();

      span.setAttributes({
        "sandbox.name": sandbox.name,
        "sandbox.session_id": session.sessionId,
        "sandbox.status": sandbox.status,
        "sandbox.timeout_ms": sandbox.timeout,
      });
      rootSpan.setAttribute("sandbox.name", sandbox.name);
      rootSpan.setAttribute("sandbox.session_id", session.sessionId);

      return sandbox;
    },
  );

  try {
    await runAgent({ sandbox });
  } finally {
    await withSpan(
      "sandbox.stop",
      {
        "demo.run_id": runId,
        "sandbox.name": sandbox.name,
        "sandbox.session_id": sandbox.currentSession().sessionId,
      },
      () => sandbox.stop(),
    );
  }
});

await forceFlushTraces();
await printRecentRawTreeSpans();

async function runAgent({
  sandbox,
}: {
  sandbox: VercelSandbox;
}): Promise<void> {
  const bashCallSpans: BashCall[] = [];
  const bashSandbox = createVercelSandboxAdapter(sandbox);
  const bashDestination = "/vercel/sandbox/workspace";
  const { tools } = await withSpan(
    "bash-tool.create",
    {
      "demo.run_id": runId,
      "sandbox.name": sandbox.name,
      "sandbox.session_id": sandbox.currentSession().sessionId,
      "bash_tool.destination": bashDestination,
    },
    () =>
      createBashTool({
        sandbox: bashSandbox,
        destination: bashDestination,
        files: {
          "task.json": JSON.stringify(
            {
              expectedKeys: ["ok", "runtime", "platform", "cwd", "runId"],
              runId,
            },
            null,
            2,
          ),
        },
        maxOutputLength: 4000,
        extraInstructions:
          "Prefer one concise command. The task.json file is already in the working directory.",
        onBeforeBashCall: ({ command }) => {
          const span = tracer.startSpan("sandbox.bash", {
            attributes: compact({
              "demo.run_id": runId,
              "sandbox.name": sandbox.name,
              "sandbox.session_id": sandbox.currentSession().sessionId,
              "sandbox.command": command,
            }),
          });
          bashCallSpans.push({ command, span });
          return undefined;
        },
        onAfterBashCall: ({ command, result }) => {
          const call = bashCallSpans.shift();
          const span = call?.span;
          if (!span) {
            return;
          }

          span.setAttributes({
            "sandbox.command": command,
            "sandbox.command.exit_code": result.exitCode,
            "sandbox.command.stdout_tail": tail(result.stdout),
            "sandbox.command.stderr_tail": tail(result.stderr),
            "sandbox.command.stdout_bytes": byteLength(result.stdout),
            "sandbox.command.stderr_bytes": byteLength(result.stderr),
          });

          if (result.exitCode !== 0) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `Command exited with ${result.exitCode}`,
            });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }
          span.end();
          return undefined;
        },
      }),
  );

  try {
    const result = await generateText({
      model,
      system:
        "You are a coding agent. Use the bash tool for all shell work. Keep the final answer brief.",
      prompt: [
        "Create a tiny proof that the sandbox works.",
        "Use the bash tool to inspect task.json and run a Node.js one-liner in the sandbox.",
        "The command should print JSON with keys ok, runtime, platform, cwd, and runId.",
        "After the tool result, summarize what happened in one sentence.",
      ].join(" "),
      stopWhen: stepCountIs(3),
      toolChoice: { type: "tool", toolName: "bash" },
      experimental_telemetry: {
        isEnabled: true,
        functionId: "sandbox-agent",
        metadata: {
          "demo.run_id": runId,
          runId,
          sandboxName: sandbox.name,
          sandboxSessionId: sandbox.currentSession().sessionId,
          example: "rawtree-vercel-sandbox-ai-sdk",
          shellTool: "bash-tool",
        },
        recordInputs: true,
        recordOutputs: true,
      },
      tools,
    });

    console.log("agent_text:", result.text.trim());
  } finally {
    endPendingBashSpans(bashCallSpans);
  }
}

function createVercelSandboxAdapter(sandbox: VercelSandbox): BashToolSandbox {
  return {
    async executeCommand(command: string): Promise<CommandResult> {
      const result = await sandbox.runCommand("bash", ["-c", command]);
      const [stdout, stderr] = await Promise.all([
        result.stdout(),
        result.stderr(),
      ]);

      return {
        stdout,
        stderr,
        exitCode: result.exitCode ?? 0,
      };
    },
    async readFile(path: string): Promise<string> {
      const content = await sandbox.readFileToBuffer({ path });
      if (content === null) {
        throw new Error(`File not found: ${path}`);
      }
      return content.toString("utf8");
    },
    async writeFiles(files): Promise<void> {
      await sandbox.writeFiles(
        files.map(({ path, content }) => ({
          path,
          content: Buffer.isBuffer(content) ? content : Buffer.from(content),
        })),
      );
    },
  };
}

async function withSpan<T>(
  name: string,
  attributes: SpanAttributeInput,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    name,
    { attributes: compact(attributes) },
    async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        const normalizedError = toError(error);
        span.recordException(normalizedError);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: normalizedError.message,
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

async function forceFlushTraces(): Promise<void> {
  await telemetry.forceFlush();
  await sleep(1500);
}

async function printRecentRawTreeSpans(): Promise<void> {
  const rawtree = new RawTree({
    apiKey: requiredEnv("RAWTREE_API_KEY"),
  });

  const result = await rawtree.query(`
    WITH toString(__raw_data) AS raw
    SELECT
      JSONExtractString(raw, 'name') AS name,
      JSONExtractString(raw, 'traceId') AS trace_id,
      JSONExtractString(raw, 'spanId') AS span_id,
      JSONExtractString(raw, 'parentSpanId') AS parent_span_id,
      JSONExtractString(raw, 'kind') AS kind,
      JSONExtractString(JSONExtractRaw(raw, 'status'), 'code') AS status_code,
      JSONExtractString(raw, 'startTimeUnixNano') AS start_time_unix_nano
    FROM ${tableIdentifier(telemetry.tableName)}
    WHERE raw LIKE '%${runId}%'
    ORDER BY start_time_unix_nano DESC
    LIMIT 20
  `);

  console.table(result.data);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} before starting the demo.`);
  }
  return value;
}

function compact(value: SpanAttributeInput): Attributes {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Attributes;
}

function tail(value: string, maxLength = 2000): string {
  return value.length <= maxLength ? value : value.slice(-maxLength);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function endPendingBashSpans(calls: BashCall[]): void {
  for (const call of calls.splice(0)) {
    call.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: "Bash command did not complete before the agent run ended.",
    });
    call.span.end();
  }
}

function tableIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid RawTree table name: ${value}`);
  }
  return `\`${value}\``;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
