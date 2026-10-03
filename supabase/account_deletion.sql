-- Account deletion: a 7-day soft-delete grace, then a hard delete.
-- Run in the Supabase dashboard: SQL Editor -> New query -> Run. Idempotent.
--
-- WHERE THE DELETE POLICY WENT, and why not on budget_entities.
--
-- schema.sql warns that a feature which DELETEs will appear to succeed
-- against a table with no delete policy, because PostgREST answers 204 for a
-- statement that matched nothing. That warning is heeded here — but the
-- delete it applies to is on THIS table, not on budget_entities, because the
-- client never deletes an entity row:
--
--   requesting deletion  = INSERT one row here
--   cancelling it        = DELETE that row   <- the delete policy below
--   the actual purge     = SECURITY DEFINER, server-side, never the client
--
-- Giving the client DELETE on budget_entities would widen the only thing
-- standing between a public anon key and everyone's financial history, to
-- enable nothing: the purge cannot run as the user anyway, since removing
-- an auth.users row needs privileges no client has. The same warning also
-- says not to tidy that absence into a permissive policy, and that still
-- holds.

create table if not exists account_deletions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  -- The grace period, stored as an absolute instant rather than computed at
  -- purge time: a user is owed the seven days they were PROMISED, and
  -- recomputing later would silently move the date if the window changed.
  purge_after  timestamptz not null default now() + interval '7 days'
);

alter table account_deletions enable row level security;

drop policy if exists "see own deletion request" on account_deletions;
create policy "see own deletion request"
  on account_deletions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "request own deletion" on account_deletions;
create policy "request own deletion"
  on account_deletions for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Cancelling is the one delete a client performs anywhere in this app.
drop policy if exists "cancel own deletion" on account_deletions;
create policy "cancel own deletion"
  on account_deletions for delete
  to authenticated
  using (auth.uid() = user_id);

-- No UPDATE policy: a request is created or withdrawn, never edited. An
-- update policy would let a client push its own purge date back for ever,
-- which is a deletion that never happens wearing the costume of one that
-- does.

-- ---------------------------------------------------------------------------
-- The purge. SECURITY DEFINER because removing an auth.users row needs
-- privileges no client has — and deleting the auth user is the whole job:
-- budget_entities, account_deletions and budget_states all cascade from it,
-- so there is exactly one statement and no way to half-delete someone.
create or replace function purge_due_accounts() returns integer as $$
declare
  purged integer;
begin
  with due as (
    select user_id from account_deletions where purge_after <= now()
  ), gone as (
    delete from auth.users u using due where u.id = due.user_id returning u.id
  )
  select count(*) into purged from gone;
  return purged;
end;
$$ language plpgsql security definer set search_path = public, auth;

revoke all on function purge_due_accounts() from public;

-- TWO TRIGGERS FOR IT, because either alone has a hole.
--
-- 1. pg_cron, if the project has it: the only thing that purges an account
--    whose owner never comes back — which is most of them, since someone
--    who asked to be deleted is unlikely to sign in again.
-- 2. A sign-in-time call from the client (see storage.js), which costs one
--    RPC and means the purge still happens if cron is unavailable or
--    disabled. It cannot be the only mechanism for the reason above.
--
-- Enable cron in Dashboard -> Database -> Extensions -> pg_cron, then:
--
--   select cron.schedule('purge-due-accounts', '17 3 * * *',
--                        $$select purge_due_accounts()$$);
--
-- Verify it is scheduled:   select * from cron.job;
-- Verify it ran:            select * from cron.job_run_details order by start_time desc limit 5;
--
-- If pg_cron is NOT available, say so in the privacy page rather than
-- implying a timer exists: deletion then happens the next time anyone signs
-- in, which in practice is days not minutes.

grant execute on function purge_due_accounts() to authenticated;
