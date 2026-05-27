export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerRawTreeTracing } = await import("@/lib/rawtree/tracing");
    registerRawTreeTracing();
  }
}
