-- Sign in with Apple: the two tables deletion needs, and the one change
-- to the purge that makes revocation impossible to skip.
-- Run in the Supabase dashboard: SQL Editor -> New query -> Run. Idempotent.
--
-- WHY ANY OF THIS EXISTS. Apple requires an app that offers Sign in with
-- Apple to REVOKE the user's tokens when their account is deleted.
-- Deleting the auth.users row removes OUR record of the person and
-- leaves Apple's grant standing, so the existing purge — which is one
-- correct statement — is not enough on its own.
--
-- The revoke call is authenticated with a client secret JWT signed by
-- the .p8 key, which is why it cannot happen in the app and cannot
-- happen in Postgres either. It happens in an edge function
-- (supabase/functions/apple-revoke). What Postgres does is make sure
-- the function always has something to work from.

-- ---------------------------------------------------------------------------
-- The Apple refresh token, one per user.
--
-- It comes from exchanging the authorizationCode the sign-in returns —
-- which expires in five minutes and works once, so the exchange happens
-- at sign-in and this is where the durable half lands.
create table if not exists apple_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);

-- RLS ON WITH NO POLICIES AT ALL, which is the point rather than an
-- omission. With RLS enabled and nothing granted, the anon and
-- authenticated roles can neither read nor write a single row; only the
-- service role, which bypasses RLS, touches this table. A user has no
-- business reading their own Apple refresh token and every business in
-- nobody else reading it.
alter table apple_tokens enable row level security;
revoke all on table apple_tokens from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The revocation queue.
--
-- IT HOLDS THE TOKEN, NOT THE USER ID, and that is the whole design.
-- Deleting the auth.users row cascades apple_tokens away, so anything
-- that looked the token up AFTER the delete would find nothing. The
-- token is copied in here first, inside the same statement that deletes
-- the user, and this table has no foreign key — so it survives the
-- cascade and the edge function can drain it whenever it next runs.
--
-- The consequence worth stating plainly: revocation is not synchronous
-- with deletion and does not need to be. Apple asks that the grant be
-- revoked, not that it be revoked in the same millisecond.
create table if not exists apple_revocations (
  id            bigserial primary key,
  refresh_token text not null,
  queued_at     timestamptz not null default now(),
  revoked_at    timestamptz,
  -- Kept rather than deleted on success, so "did we actually revoke
  -- this" has an answer. There is no user id in here to identify
  -- anybody by; the row is the token and when it was dealt with.
  last_error    text
);
alter table apple_revocations enable row level security;
revoke all on table apple_revocations from anon, authenticated;

create index if not exists apple_revocations_pending
  on apple_revocations (queued_at) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- The purge, with the queue write in front of the delete.
--
-- Replaces the version in account_deletion.sql. ONE statement still, so
-- there is still no way to half-delete someone: the queue insert and
-- the user delete are the same CTE and the same transaction. If the
-- delete rolls back, nothing is queued; if it commits, the token is
-- already in the queue.
--
-- A user who never signed in with Apple contributes no row, because the
-- join finds nothing. That is most of them.
create or replace function purge_due_accounts() returns integer as $$
declare
  purged integer;
begin
  with due as (
    select user_id from account_deletions where purge_after <= now()
  ), queued as (
    insert into apple_revocations (refresh_token)
    select t.refresh_token from apple_tokens t join due on t.user_id = due.user_id
    returning 1
  ), gone as (
    delete from auth.users u using due where u.id = due.user_id returning u.id
  )
  select count(*) into purged from gone;
  return purged;
end;
$$ language plpgsql security definer set search_path = public, auth;

revoke all on function purge_due_accounts() from public;
grant execute on function purge_due_accounts() to authenticated;

-- ---------------------------------------------------------------------------
-- DRAINING THE QUEUE. The edge function does the HTTP; something has to
-- call it. Two options, in order of preference:
--
-- 1. pg_cron + pg_net, so it runs whether or not anybody opens the app:
--
--      select cron.schedule('drain-apple-revocations', '37 3 * * *', $$
--        select net.http_post(
--          url     := 'https://<project-ref>.supabase.co/functions/v1/apple-revoke',
--          headers := jsonb_build_object(
--            'Content-Type', 'application/json',
--            'Authorization', 'Bearer ' || '<service role key>')
--        );
--      $$);
--
--    Scheduled twenty minutes after the purge, so the queue it drains
--    is the one that purge just filled.
--
-- 2. By hand, which is honest for a queue that is usually empty:
--
--      curl -s -X POST \
--        -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
--        https://<project-ref>.supabase.co/functions/v1/apple-revoke
--
-- What is still pending, at any time:
--
--   select count(*) from apple_revocations where revoked_at is null;
