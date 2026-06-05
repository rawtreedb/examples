# RawTree Supabase ETL

Streams rows from a Supabase Postgres publication into a RawTree table.

```text
Supabase Postgres publication -> supabase/etl -> RawTree table
```

This example uses Supabase ETL's Rust pipeline and a small RawTree destination.
It sends source columns at the top level and adds `_etl_*` metadata fields such
as `_etl_op`, `_etl_schema`, `_etl_table`, and LSNs.

## Setup

Install Rust and Cargo if they are not already available:

```sh
rustc --version
cargo --version
```

Copy the example environment file and fill in your values:

```sh
cp postgres/supabase-etl/.env.example .env.local
```

Required values:

```sh
RAWTREE_API_KEY=rt_...
DATABASE_URL=postgres://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
POSTGRES_TLS_ROOT_CERT_PATH=./supabase-ca.pem
POSTGRES_PUBLICATION=rawtree_publication
RAWTREE_TABLE=supabase_cdc_events
```

Use the Supabase direct database endpoint, not the pooler URL. The pooler works
for normal SQL, but logical replication needs a direct replication connection
and replication slots.

Supabase direct Postgres can be IPv6-only. If your local network cannot reach
the direct host, run the example from an IPv6-capable host.

Supabase direct Postgres may require the Supabase database CA instead of your
host OS certificate bundle. Download the database CA from Supabase and save it
at the path in `POSTGRES_TLS_ROOT_CERT_PATH`.

Create a table and publication to replicate:

```sql
create table if not exists public.rawtree_etl_smoke (
  id bigserial primary key,
  run_id text not null,
  message text not null,
  amount numeric,
  tags text[],
  payload jsonb default '{}'::jsonb,
  active boolean default true,
  created_at timestamptz default now()
);

drop publication if exists rawtree_publication;
create publication rawtree_publication for table public.rawtree_etl_smoke;
```

## Run

```sh
npm run postgres:supabase
```

In another SQL session, insert or update rows in the published table:

```sql
insert into public.rawtree_etl_smoke (run_id, message, amount, tags, payload)
values (
  'supabase-etl-demo',
  'hello from supabase',
  12.34,
  array['supabase', 'rawtree'],
  '{"source":"supabase"}'::jsonb
);
```

Then query RawTree to inspect the raw CDC events:

```sql
select _etl_op, run_id, message, amount, _etl_schema, _etl_table
from supabase_cdc_events
where run_id = 'supabase-etl-demo'
order by _etl_commit_lsn desc
limit 20;
```

## Query Current Rows

RawTree stores this example as an append-only CDC event log. Each source row can
have multiple events: `copy`, `insert`, `update`, and `delete`. To see the live
table state, query the latest event per primary key and remove keys whose latest
event is `delete`.

This query reconstructs the current rows for the sample table:

```sql
with row_events as (
  select
    *,
    reinterpretAsUInt64(reverse(unhex(concat(
      leftPad(splitByChar('/', toString(_etl_commit_lsn))[1], 8, '0'),
      leftPad(splitByChar('/', toString(_etl_commit_lsn))[2], 8, '0')
    )))) as commit_lsn_u64,
    toUInt64OrZero(toString(_etl_tx_ordinal)) as tx_ordinal
  from supabase_cdc_events
  where toString(_etl_op) in ('copy', 'insert', 'update', 'delete')
),
latest as (
  select
    id,
    argMax(toString(_etl_op), tuple(commit_lsn_u64, tx_ordinal)) as last_op,
    argMax(toString(run_id), tuple(commit_lsn_u64, tx_ordinal)) as run_id,
    argMax(toString(message), tuple(commit_lsn_u64, tx_ordinal)) as message,
    argMax(toString(amount), tuple(commit_lsn_u64, tx_ordinal)) as amount,
    argMax(toString(tags), tuple(commit_lsn_u64, tx_ordinal)) as tags,
    argMax(toString(active), tuple(commit_lsn_u64, tx_ordinal)) as active,
    argMax(toString(created_at), tuple(commit_lsn_u64, tx_ordinal)) as created_at
  from row_events
  group by id
)
select
  id,
  run_id,
  message,
  amount,
  tags,
  active,
  created_at
from latest
where last_op != 'delete'
order by id;
```

The important pieces are:

- `row_events` keeps only row-level CDC events and ignores transaction markers
  like `begin`, `commit`, and `relation`.
- `commit_lsn_u64` converts Postgres LSN text such as `1/F20001D8` into a
  sortable integer.
- `argMax(column, tuple(commit_lsn_u64, tx_ordinal))` returns the column value
  from the latest event for each primary key.
- `where last_op != 'delete'` removes rows that no longer exist in Postgres.

For another table, replace `id` with that table's primary key and list the
columns you want to project from the latest event. For a composite primary key,
group by all key columns. If RawTree flattens nested JSON fields into dotted
column names, reference those fields with quoted identifiers, for example
`` `payload.source` ``.

## Notes

On first run, `supabase/etl` creates internal metadata objects in the source
database, including the `etl` schema and DDL trigger used by the pipeline.

The default pipeline id is `1`, so the apply replication slot is
`supabase_etl_apply_1`. Stop the process before cleaning it up:

```sql
select slot_name, active, plugin
from pg_replication_slots
where slot_name like 'supabase_etl_%';

select pg_drop_replication_slot(slot_name)
from pg_replication_slots
where slot_name = 'supabase_etl_apply_1'
  and not active;
```
