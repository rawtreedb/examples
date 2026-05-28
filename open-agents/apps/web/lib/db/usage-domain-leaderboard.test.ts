import { afterEach, describe, expect, test } from "bun:test";
import {
  getAllowedOrganizationEmailDomain,
  isEmailAllowedToAuthenticate,
} from "@/lib/auth/allowed-email-domains";
import { buildUsageDomainLeaderboardRows } from "./usage-domain-leaderboard";

const originalAllowedDomains = process.env.OPEN_AGENTS_ALLOWED_EMAIL_DOMAINS;

describe("allowed email domains", () => {
  afterEach(() => {
    if (originalAllowedDomains === undefined) {
      delete process.env.OPEN_AGENTS_ALLOWED_EMAIL_DOMAINS;
    } else {
      process.env.OPEN_AGENTS_ALLOWED_EMAIL_DOMAINS = originalAllowedDomains;
    }
  });

  test("allows authentication when no domain restriction is configured", () => {
    delete process.env.OPEN_AGENTS_ALLOWED_EMAIL_DOMAINS;

    expect(isEmailAllowedToAuthenticate("alice@example.com")).toBe(true);
    expect(getAllowedOrganizationEmailDomain("alice@example.com")).toBeNull();
  });

  test("accepts configured organization domains", () => {
    process.env.OPEN_AGENTS_ALLOWED_EMAIL_DOMAINS = "tinybird.co, rawtree.com";

    expect(isEmailAllowedToAuthenticate("alice@tinybird.co")).toBe(true);
    expect(getAllowedOrganizationEmailDomain("alice@tinybird.co")).toBe(
      "tinybird.co",
    );
    expect(getAllowedOrganizationEmailDomain("bob@rawtree.com")).toBe(
      "rawtree.com",
    );
  });

  test("rejects personal and unverified domains", () => {
    process.env.OPEN_AGENTS_ALLOWED_EMAIL_DOMAINS = "tinybird.co,gmail.com";

    expect(isEmailAllowedToAuthenticate("alice@gmail.com")).toBe(false);
    expect(isEmailAllowedToAuthenticate("alice@hotmail.com")).toBe(false);
    expect(isEmailAllowedToAuthenticate("alice@example.com")).toBe(false);
    expect(isEmailAllowedToAuthenticate("missing-at-symbol")).toBe(false);
    expect(isEmailAllowedToAuthenticate(undefined)).toBe(false);
    expect(getAllowedOrganizationEmailDomain("alice@gmail.com")).toBeNull();
    expect(getAllowedOrganizationEmailDomain("alice@example.com")).toBeNull();
  });
});

describe("buildUsageDomainLeaderboardRows", () => {
  test("aggregates total tokens per user and derives the top model without exposing emails", () => {
    const rows = buildUsageDomainLeaderboardRows([
      {
        userId: "user-1",
        email: "alice@vercel.com",
        username: "alice",
        name: "Alice",
        avatarUrl: "https://example.com/alice.png",
        modelId: "anthropic/claude-sonnet-4",
        totalInputTokens: 80,
        totalOutputTokens: 20,
      },
      {
        userId: "user-1",
        email: "alice@vercel.com",
        username: "alice",
        name: "Alice",
        avatarUrl: "https://example.com/alice.png",
        modelId: "openai/gpt-5",
        totalInputTokens: 40,
        totalOutputTokens: 20,
      },
      {
        userId: "user-2",
        email: "bob@vercel.com",
        username: "bob",
        name: null,
        avatarUrl: null,
        modelId: null,
        totalInputTokens: 70,
        totalOutputTokens: 20,
      },
      {
        userId: "user-3",
        email: null,
        username: "ignored",
        name: null,
        avatarUrl: null,
        modelId: "openai/gpt-5",
        totalInputTokens: 999,
        totalOutputTokens: 999,
      },
      {
        userId: "user-4",
        email: "zero@vercel.com",
        username: "zero",
        name: null,
        avatarUrl: null,
        modelId: "openai/gpt-5",
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    ]);

    expect(rows).toEqual([
      {
        userId: "user-1",
        username: "alice",
        name: "Alice",
        avatarUrl: "https://example.com/alice.png",
        totalTokens: 160,
        mostUsedModelId: "anthropic/claude-sonnet-4",
        mostUsedModelTokens: 100,
      },
      {
        userId: "user-2",
        username: "bob",
        name: null,
        avatarUrl: null,
        totalTokens: 90,
        mostUsedModelId: null,
        mostUsedModelTokens: 90,
      },
    ]);
    expect(rows[0]).not.toHaveProperty("email");
  });

  test("prefers a known model over unknown when token totals tie", () => {
    const [row] = buildUsageDomainLeaderboardRows([
      {
        userId: "user-1",
        email: "alice@vercel.com",
        username: "alice",
        name: "Alice",
        avatarUrl: "https://example.com/alice.png",
        modelId: null,
        totalInputTokens: 50,
        totalOutputTokens: 0,
      },
      {
        userId: "user-1",
        email: "alice@vercel.com",
        username: "alice",
        name: "Alice",
        avatarUrl: "https://example.com/alice.png",
        modelId: "openai/gpt-5",
        totalInputTokens: 40,
        totalOutputTokens: 10,
      },
    ]);

    expect(row).toEqual({
      userId: "user-1",
      username: "alice",
      name: "Alice",
      avatarUrl: "https://example.com/alice.png",
      totalTokens: 100,
      mostUsedModelId: "openai/gpt-5",
      mostUsedModelTokens: 50,
    });
  });
});
