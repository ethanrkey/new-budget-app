-- Entity storage: one row per entity, replacing the single jsonb document.
-- Run in the Supabase dashboard: Project -> SQL Editor -> New query -> paste
-- -> Run. Idempotent; safe to re-run.
--
-- ORDER MATTERS. This file is step 1 of four, and the order is not cosmetic:
--   1. this file            create the table, RLS, policies, trigger
--   2. scripts/backfill_entities.mjs
--   3. scripts/verify_entities.mjs      <- BEFORE any write switches over
--   4. supabase/freeze_budget_states.sql
-- Verify before switching writes. Switch first and the thing you would have
-- compared against has already moved, so the verification proves nothing.

create table if not exists budget_entities (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  kind           text        not null,
  entity_id      text        not null,
  data           jsonb       not null,
  -- Per-entity optimistic concurrency. A COUNTER, not a timestamp: a counter
  -- has no clock in it, and this codebase already refuses to trust device
  -- clocks (see syncGuard.ts). The client writes
  -- `... where version = <the one it loaded>`; zero rows matched means
  -- somebody else got there first.
  version        integer     not null default 1,
  -- What shape `data` is in. A client reading a HIGHER number than it
  -- understands must refuse to sync and go read-only rather than write back
  -- a mangled row: the web app is always latest, an App Store build is not.
  schema_version integer     not null default 1,
  -- Tombstone. Deletes have to WIN across devices, and a row that is simply
  -- absent cannot outrank a stale device's copy of it.
  deleted_at     timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, kind, entity_id)
);

-- Snapshots are keyed by date (`<ownerId>:<YYYY-MM-DD>`), so "one balance per
-- date" is enforced by this primary key rather than by a mutator. A mutator
-- can be bypassed, added alongside, or forgotten by a second client. Do not
-- "fix" those keys into uids. See PROJECT_SPEC §10.

-- Rows are only ever read in bulk for one user; the PK prefix covers it.
-- A partial index on live rows keeps the common read off the tombstones.
create index if not exists budget_entities_live
  on budget_entities (user_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- RLS. This is the ENTIRE security model: the repo is public and the anon key
-- ships in the client, so a policy gap is a full breach, not a degradation.
-- Policies are OR'd — one over-broad policy anywhere opens the whole table.
alter table budget_entities enable row level security;

drop policy if exists "select own entities" on budget_entities;
create policy "select own entities"
  on budget_entities for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "insert own entities" on budget_entities;
create policy "insert own entities"
  on budget_entities for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update own entities" on budget_entities;
create policy "update own entities"
  on budget_entities for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- NO delete policy, deliberately, exactly as on budget_states. The client
-- never hard-deletes: a delete is `set deleted_at = now()`, which is an
-- UPDATE. Purging expired tombstones runs server-side only (pg_cron or an
-- Edge Function with the service_role key), so a client can never actually
-- destroy a row.
--
-- Two traps, both easy to hit later:
--   1. A future feature that DELETEs will APPEAR to succeed — PostgREST
--      answers 204 for a statement that matched nothing. Add a policy here
--      at the same time or it fails silently.
--   2. Do not "tidy" this absence into a permissive policy.

-- ---------------------------------------------------------------------------
-- The version counter is the server's to assign, never the client's. A client
-- that could set it could also replay an old one.
create or replace function bump_entity_version() returns trigger as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists budget_entities_bump on budget_entities;
create trigger budget_entities_bump
  before update on budget_entities
  for each row execute function bump_entity_version();

-- ---------------------------------------------------------------------------
-- Verification. Reading this file is not the same as checking the database.
--
--   select relrowsecurity from pg_class where relname = 'budget_entities';
--   -- expect: true
--
--   select polname, polcmd, polroles::regrole[],
--          pg_get_expr(polqual, polrelid)      as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as check_expr
--     from pg_policy where polrelid = 'budget_entities'::regclass;
--   -- expect EXACTLY three rows (select/insert/update), every expression
--   -- mentioning auth.uid(), polroles = {authenticated}.
--   -- ANY extra row, or any expression that is `true`, is a breach.
