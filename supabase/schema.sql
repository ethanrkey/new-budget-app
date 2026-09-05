-- Budget app: one JSON blob per signed-in user, row-level-security protected.
-- Run once in the Supabase dashboard: Project -> SQL Editor -> New query ->
-- paste this whole file -> Run. Safe to re-run (idempotent) if you ever need to.

create table if not exists budget_states (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table budget_states enable row level security;

drop policy if exists "select own state" on budget_states;
create policy "select own state"
  on budget_states for select
  using (auth.uid() = user_id);

drop policy if exists "insert own state" on budget_states;
create policy "insert own state"
  on budget_states for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own state" on budget_states;
create policy "update own state"
  on budget_states for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
