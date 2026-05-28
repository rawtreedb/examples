import { isToolUIPart, type LanguageModel, type UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  getRawTreeUsageHistory,
  recordRawTreeUsageEvent,
} from "@/lib/rawtree/usage";
import type { UsageDateRange } from "@/lib/usage/date-range";
import { db } from "./client";
import { users } from "./schema";

export type UsageSource = "web";
export type UsageAgentType = "main" | "subagent";

export async function recordUsage(
  userId: string,
  data: {
    source: UsageSource;
    agentType?: UsageAgentType;
    model: LanguageModel | string;
    messages: UIMessage[];
    usage: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
    };
    toolCallCount?: number;
  },
) {
  const inferredToolCallCount = data.messages
    .flatMap((m) => m.parts)
    .filter(isToolUIPart).length;
  const toolCallCount = data.toolCallCount ?? inferredToolCallCount;

  const provider =
    typeof data.model === "string"
      ? data.model.split("/")[0]
      : data.model.provider;
  const modelId =
    typeof data.model === "string" ? data.model : data.model.modelId;
  const id = nanoid();
  const createdAt = new Date();

  const event = {
    id,
    userId,
    source: data.source,
    agentType: data.agentType ?? "main",
    provider: provider ?? null,
    modelId: modelId ?? null,
    inputTokens: data.usage.inputTokens,
    cachedInputTokens: data.usage.cachedInputTokens,
    outputTokens: data.usage.outputTokens,
    toolCallCount,
    createdAt,
  };

  const [user] = await db
    .select({
      avatarUrl: users.avatarUrl,
      email: users.email,
      name: users.name,
      username: users.username,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  await recordRawTreeUsageEvent(
    {
      ...event,
      createdAt: createdAt.toISOString(),
    },
    user ?? null,
  );
}

export interface DailyUsage {
  date: string;
  source: UsageSource;
  agentType: UsageAgentType;
  provider: string | null;
  modelId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

export interface UsageHistoryOptions {
  days?: number;
  range?: UsageDateRange;
  allTime?: boolean;
}

export async function getUsageHistory(
  userId: string,
  options?: UsageHistoryOptions,
): Promise<DailyUsage[]> {
  return getRawTreeUsageHistory(userId, options);
}
