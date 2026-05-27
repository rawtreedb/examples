export type RawTreeProductSpanCategory = "agent" | "ai" | "sandbox";

export function getRawTreeProductSpanCategory(
  name: string,
  attributes: Record<string, unknown>,
): RawTreeProductSpanCategory | null {
  if (isRawTreeSandboxSpan(name, attributes)) {
    return "sandbox";
  }

  if (name === "open-agents.agent.step") {
    return "agent";
  }

  if (isRawTreeAiSpan(name, attributes)) {
    return "ai";
  }

  return null;
}

export function isRawTreeProductSpan(
  name: string,
  attributes: Record<string, unknown>,
): boolean {
  return getRawTreeProductSpanCategory(name, attributes) !== null;
}

export function isRawTreeSandboxSpan(
  name: string,
  attributes: Record<string, unknown>,
): boolean {
  return (
    name.startsWith("sandbox.") ||
    name === "open-agents.sandbox.provision" ||
    attributes["sandbox.name"] !== undefined ||
    attributes["sandbox.session_id"] !== undefined
  );
}

function isRawTreeAiSpan(
  name: string,
  attributes: Record<string, unknown>,
): boolean {
  return (
    name.startsWith("ai.") ||
    attributes["ai.operationId"] !== undefined ||
    attributes["gen_ai.system"] !== undefined
  );
}
