# RawTree Open Agents Notes

This folder vendors `vercel-labs/open-agents` so we can adapt its agent metrics,
user-facing activity, and leaderboard surfaces to RawTree.

Source:

- Repository: https://github.com/vercel-labs/open-agents
- Imported commit: `24d679c7ba3d274aa73814c15673aeffcbe3c1c2`
- License: MIT, preserved in `LICENSE.md`

Initial adaptation target:

- Identify the existing metrics and leaderboard data paths.
- Replace or augment those data paths with RawTree ingest/query examples.
- Keep the upstream app runnable while the RawTree-specific pieces are added.

## Implemented Usage Path

Set `RAWTREE_API_KEY` in `apps/web/.env` to enable RawTree usage storage.

When configured, `apps/web/lib/db/usage.ts` still writes the existing Postgres
`usage_events` row, then mirrors the denormalized event into RawTree table
`open_agents_usage_events`.

The existing app call sites stay unchanged:

- `getUsageHistory()` reads daily token history from RawTree.
- `getUsageInsights()` reads token aggregates from RawTree and keeps the
  session-derived PR/code metrics from Postgres.
- `getUsageDomainLeaderboard()` reads domain leaderboard token totals from
  RawTree using denormalized user fields captured on each event.

If `RAWTREE_API_KEY` is absent, RawTree is unavailable, or the RawTree table has
not been created yet, the app falls back to the original Postgres queries.
