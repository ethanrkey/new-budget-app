-- Budget app: one JSON blob per signed-in user, row-level-security protected.
-- Run once in the Supabase dashboard: Project -> SQL Editor -> New query ->
-- paste this whole file -> Run. Safe to re-run (idempotent) if you ever need to.

create table if not exists budget_states (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

-- RLS is the ENTIRE security model here: the repo is public and the anon key
-- ships in the client, so a policy gap is a full breach, not a degradation.
-- Verified live 2026-10-02 (see PROJECT_SPEC §5) — an anon insert is rejected
-- with 42501, which only happens when RLS is actually on.
alter table budget_states enable row level security;

drop policy if exists "select own state" on budget_states;
create policy "select own state"
  on budget_states for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "insert own state" on budget_states;
create policy "insert own state"
  on budget_states for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update own state" on budget_states;
create policy "update own state"
  on budget_states for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- There is deliberately NO delete policy. The app never deletes a row —
-- "Wipe data" clears fields and saves the emptied blob — so with RLS on,
-- every DELETE matches zero rows and is denied fail-closed. Two things
-- follow, and both are easy to trip over:
--   1. A future feature that deletes a row will APPEAR to succeed. PostgREST
--      answers 204 for a delete that matched nothing. Add a policy here
--      (`to authenticated using (auth.uid() = user_id)`) at the same time,
--      or it will fail silently.
--   2. Do not "tidy" this absence into a permissive policy. Policies are
--      OR'd: one over-broad policy anywhere opens the whole table.

-- Verification, because reading this file is not the same as checking what
-- the database actually has. Run in the SQL editor; both results matter:
--
--   select relrowsecurity, relforcerowsecurity
--     from pg_class where relname = 'budget_states';
--   -- expect: true, (force is optional)
--
--   select polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid) as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as check_expr
--     from pg_policy where polrelid = 'budget_states'::regclass;
--   -- expect EXACTLY the three above, every expression mentioning auth.uid().
--   -- ANY extra row, or any expression that is `true`, is a breach.
