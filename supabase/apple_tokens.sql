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

-- Retry bookkeeping. A failed revocation is retried rather than
-- dropped — Apple still believes the grant is live, and dropping the
-- row would make that permanent and invisible — but "retry" without a
-- clock means hammering Apple once a minute for ever. The edge
-- function waits an hour between attempts on the same row.
alter table apple_revocations add column if not exists attempts        integer not null default 0;
alter table apple_revocations add column if not exists last_attempt_at timestamptz;
alter table apple_revocations enable row level security;
revoke all on table apple_revocations from anon, authenticated;

create index if not exists apple_revocations_pending
  on apple_revocations (queued_at) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- ONE PENDING ROW PER TOKEN. Added 2026-10-14 after the queue held two
-- rows for a single deleted account, and the timestamps said exactly
-- what happened:
--
--   id=1  queued 2026-10-13T20:02:48.969148Z
--   id=2  queued 2026-10-13T20:02:48.966760Z
--
-- 2.4 milliseconds apart — and `now()` in Postgres is TRANSACTION
-- START time, so one statement inserting two rows would have given
-- two identical timestamps. Two timestamps means two transactions.
--
-- The second caller is ours: `purgeDueAccounts()` runs from an effect
-- in App.jsx on every load, as the backstop for pg_cron. Two of those
-- landing milliseconds apart — a session refresh, two tabs, React
-- running an effect twice — both see the same due row and the same
-- token under the same snapshot, both queue it, and one of them wins
-- the delete. Nothing is wrong with calling the purge twice; it is
-- supposed to be safe to call from anywhere. So the queue is what has
-- to be idempotent.
--
-- PARTIAL, on `revoked_at is null`, for two reasons. A token that has
-- already been revoked and somehow comes back is harmless to queue
-- again (Apple answers invalid_grant, which this treats as done), and
-- the function BLANKS the token on success — so a plain unique index
-- would collide on the second empty string.
delete from apple_revocations a
 using apple_revocations b
 where a.revoked_at is null
   and b.revoked_at is null
   and a.refresh_token = b.refresh_token
   and a.id > b.id;

create unique index if not exists apple_revocations_one_pending_per_token
  on apple_revocations (refresh_token) where revoked_at is null;

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
    -- Two concurrent purges see the same snapshot and queue the same
    -- token twice. This is the whole fix; see the index above for the
    -- evidence that it happened.
    on conflict (refresh_token) where revoked_at is null do nothing
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
-- DRAINING THE QUEUE — RUN THIS, it is the half that was missing.
--
-- Until 2026-10-14 the only scheduled job was `purge-due-accounts`, so
-- rows went into this queue and nothing ever took them out. The purge
-- worked; the revocation never ran once.
--
-- HOURLY, not daily. The queue is empty almost all the time, so the
-- cost is a no-op HTTP call an hour, and the payoff is that a
-- revocation queued by the client-side sweep at four in the afternoon
-- does not wait until the small hours. It also lines up with the edge
-- function's one-hour retry backoff: a row that failed is eligible
-- again on the next tick, and not before.
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--
-- THE KEY MUST BE THE LEGACY `eyJ...` service_role JWT, not the newer
-- `sb_secret_...` one. Measured 2026-10-14: the functions gateway
-- answers an `sb_secret_` bearer with 401 "Invalid API key" and never
-- reaches the function. Store it in Vault rather than inlining it, so
-- it is not sitting in `cron.job` in plain text:
--
--   select vault.create_secret(
--     '<legacy service_role JWT>', 'service_role_key',
--     'Bearer token for cron-triggered edge functions');
--
--   select cron.schedule('drain-apple-revocations', '37 * * * *', $$
--     select net.http_post(
--       url     := 'https://kjcvtpmorftjyejjskwm.supabase.co/functions/v1/apple-revoke',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' ||
--           (select decrypted_secret from vault.decrypted_secrets
--             where name = 'service_role_key')),
--       body    := '{}'::jsonb
--     );
--   $$);
--
-- By hand, any time — the same call the cron job makes:
--
--   curl -s -X POST \
--     -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
--     https://kjcvtpmorftjyejjskwm.supabase.co/functions/v1/apple-revoke
--
-- ---------------------------------------------------------------------------
-- CONFIRMING IT, which is three questions and not one.
--
-- 1. Is the queue empty?
--
--      select count(*) filter (where revoked_at is null) as pending,
--             count(*) filter (where revoked_at is not null) as done
--        from apple_revocations;
--
-- 2. Did each row actually get a revocation, and how hard was it?
--
--      select id, queued_at, revoked_at, attempts, last_error
--        from apple_revocations order by queued_at;
--
--    `revoked_at` set and `last_error` null is the clean outcome. The
--    token column is blanked on success on purpose — it has done its
--    only job.
--
-- 3. Is the job actually scheduled, and did it run?
--
--      select jobname, schedule, active from cron.job;
--      select jobname, status, start_time, return_message
--        from cron.job_run_details d join cron.job j using (jobid)
--       where jobname = 'drain-apple-revocations'
--       order by start_time desc limit 5;
--
-- 4. And the question none of the above answers, because it lives at
--    Apple rather than here: open account.apple.com -> Sign in with
--    Apple, and look for Key Budget. A revoked grant disappears from
--    that list and from the iPhone Passwords app. That is the only
--    end-to-end proof; everything above is our side of it.
--
-- Two rows were queued and both were revoked by hand on 2026-10-14
-- (`{"queued":2,"attempted":2,"revoked":2,"failed":[],"waiting":0}`),
-- which is also the first time the revoke path had ever run.

-- ---------------------------------------------------------------------------
-- PROVE THE LOCK RATHER THAN TRUSTING IT. Run this after the tables
-- exist; it is the answer to "can any app user ever read an Apple
-- refresh token". Both tables must come back with rls_enabled = true
-- and policies = 0 — policies, not "no policies I remember writing".
--
-- RLS with no policies denies everything to anon and authenticated.
-- RLS with ONE permissive policy allows whatever that policy says, so
-- the count is the number that matters and 0 is the only right answer:
-- the service role bypasses RLS and is the only thing that touches
-- these tables.
--
--   select c.relname                                   as table_name,
--          c.relrowsecurity                            as rls_enabled,
--          (select count(*) from pg_policies p
--             where p.schemaname = 'public' and p.tablename = c.relname) as policies
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('apple_tokens', 'apple_revocations');
--
-- And the grants, which are the other half — a grant without a policy
-- still cannot read a row, but there is no reason for one to exist:
--
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_name in ('apple_tokens', 'apple_revocations')
--      and grantee in ('anon', 'authenticated');   -- expect zero rows
