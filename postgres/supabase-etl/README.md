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

Then query RawTree:

```sql
select _etl_op, run_id, message, amount, _etl_schema, _etl_table
from supabase_cdc_events
where run_id = 'supabase-etl-demo'
order by _etl_commit_lsn desc
limit 20;
```

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
