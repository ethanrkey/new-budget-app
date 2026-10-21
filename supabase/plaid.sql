-- Connected checking via Plaid: the tables, the lock on them, and the
-- two hooks that make a disconnection impossible to skip.
-- Run in the Supabase dashboard: SQL Editor -> New query -> Run. Idempotent.
--
-- RUN IT LAST. It redefines purge_due_accounts(), which account_deletion.sql
-- created and apple_tokens.sql already replaced once, and the version here
-- is the only one that queues BOTH an Apple revocation and a Plaid removal.
-- Run this before apple_tokens.sql and the Apple half silently disappears.
--
--   1. entities.sql
--   2. account_deletion.sql
--   3. apple_tokens.sql
--   4. this file
--
-- AND THE SECRETS, which are not in here and not in the repo:
--   supabase secrets set PLAID_CLIENT_ID=... PLAID_SECRET=... PLAID_ENV=sandbox
--   supabase secrets list        -- names only; values are never printed
--
-- ===========================================================================
-- RUNNING IT, STEP BY STEP. Dashboard -> SQL Editor -> New query.
--
-- STEP 0. Turn off statement logging for the session you are about to
-- paste a token-handling file into. Nothing below puts a secret in a
-- statement, but the Vault guide is explicit that logged INSERTs are
-- how plaintext ends up in logs, and the cost of being careful here
-- is one line:
--
--   set log_statement = 'none';
--
-- STEP 1. Paste this whole file and Run. It is idempotent: safe to
-- re-run, and re-running is how you apply a later edit. Expect
-- "Success. No rows returned".
--
-- STEP 2. CONFIRM THE VAULT VIEW'S COLUMN NAMES. This file is written
-- against `vault.decrypted_secrets (id, decrypted_secret)`, from
-- Supabase's docs, and if that view ever renames a column then
-- plaid_read_token returns nothing and every pull fails with
-- "connection is incomplete". The SQL editor has no `\d`, so:
--
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'vault' and table_name = 'decrypted_secrets'
--    order by ordinal_position;
--
-- Expect `id uuid` and `decrypted_secret text` among them. If either
-- is named differently, fix plaid_read_token and
-- plaid_read_removal_token before going further.
--
-- STEP 3. THE THREE PROOF QUERIES, which are the point of the whole
-- file. Run them now, before any data exists — they should all come
-- back the right shape and empty — and run them AGAIN after the first
-- sandbox connection, when they have something to prove.
--
--   -- 3a. RLS on, and ZERO policies, on everything secret.
--   --     Policies, not "no policies I remember writing": RLS with
--   --     one permissive policy allows whatever that policy says.
--   select c.relname                     as table_name,
--          c.relrowsecurity              as rls_enabled,
--          (select count(*) from pg_policies p
--             where p.schemaname = 'public' and p.tablename = c.relname) as policies
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('plaid_tokens', 'plaid_removals', 'plaid_api_log',
--                        'plaid_link_sessions', 'plaid_item_creations')
--    order by c.relname;
--   -- expect five rows, rls_enabled = true, policies = 0, every one.
--
--   -- 3b. The three client-readable tables: exactly one SELECT policy
--   --     each, and no INSERT, UPDATE or DELETE policy anywhere.
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('plaid_items', 'plaid_accounts', 'plaid_beta')
--    order by tablename, cmd;
--   -- expect exactly three rows, all cmd = SELECT.
--
--   -- 3c. No plaintext token exists anywhere. Empty before the first
--   --     connection; after one, plaid_tokens shows a uuid and
--   --     vault.secrets shows ciphertext.
--   select item_id, secret_id, updated_at from plaid_tokens;
--   select id, name, left(secret, 24) || '...' as ciphertext from vault.secrets
--    where name like 'plaid_%';
--   -- and the only way back, which must return an access-sandbox-... string:
--   select plaid_read_token((select item_id from plaid_tokens limit 1));
--
-- STEP 4. Grants, the other half of 3a — a grant without a policy
-- still cannot read a row, but there is no reason for one to exist:
--
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_name in ('plaid_tokens', 'plaid_removals', 'plaid_api_log',
--                         'plaid_link_sessions', 'plaid_item_creations')
--      and grantee in ('anon', 'authenticated');
--   -- expect ZERO rows.
--
-- STEP 5. Add yourself to the allowlist, or nothing is reachable:
--
--   insert into plaid_beta (user_id, note)
--   select id, 'owner, sandbox' from auth.users where email = '<your address>';
--
-- STEP 6. Deploy the four functions. Note the --no-verify-jwt on the
-- SECOND one only: Plaid's webhook does not carry a Supabase token,
-- and the other three must refuse anyone who is not signed in.
--
--   cd <repo root>
--   npx supabase functions deploy plaid-link-token  --project-ref kjcvtpmorftjyejjskwm
--   npx supabase functions deploy plaid-exchange    --project-ref kjcvtpmorftjyejjskwm --no-verify-jwt
--   npx supabase functions deploy plaid-balance     --project-ref kjcvtpmorftjyejjskwm
--   npx supabase functions deploy plaid-disconnect  --project-ref kjcvtpmorftjyejjskwm
--
-- STEP 7. Prove the secrets arrived, without printing them. A missing
-- one answers 500 and NAMES ITSELF, which is the whole reason
-- readConfig reports missing names rather than failing quietly:
--
--   curl -s -X POST -H "Authorization: Bearer $ANON_OR_USER_JWT" \
--     https://kjcvtpmorftjyejjskwm.supabase.co/functions/v1/plaid-balance
--   -- "not signed in" with an anon key = deployed and locked.
--   -- "not configured: PLAID_SECRET" = deployed, secret missing.
--
-- STEP 8. Schedule the removal drain (see DRAINING THE REMOVAL QUEUE,
-- further down). Not optional: without it, a deleted account leaves a
-- live Item at Plaid.
--
-- ---------------------------------------------------------------------------
-- HOW MANY OF THE TEN TRIAL SLOTS ARE GONE. Run it whenever you want
-- the number; it is a count of a table nothing deletes from, so it is
-- the real figure and not the live-connection count.
--
--   select env, count(*) as items_created, max(created_at) as latest
--     from plaid_item_creations
--    group by env
--    order by env;
--   -- Only the `production` row spends slots. Ten is the cap, FOREVER:
--   -- /item/remove does not give one back.
--
--   -- Which ones, newest first — a repeated institution_name is a
--   -- duplicate and cost a second slot:
--   select created_at, institution_name, plaid_item_id
--     from plaid_item_creations where env = 'production'
--    order by created_at desc;
--
--   -- Live right now, for comparison. The gap between this and the
--   -- count above is slots spent on connections that no longer exist.
--   select count(*) from plaid_items;
-- ===========================================================================
--
-- THE PRODUCT RULE THIS SCHEMA EXISTS TO ENFORCE: checking only,
-- BALANCE ONLY, and the Transactions product is never requested. There
-- is nowhere in here to put a transaction, and that is deliberate —
-- a table is an invitation, and the one thing this feature must never
-- grow into is a transaction feed.
--
-- THE SECOND RULE, which shapes every table below: MANUAL ENTRY IS THE
-- PRODUCT. A connected bank is an optional extra. Nothing here is
-- required for the app to work, nothing here is read on a path a
-- disconnected user takes, and a user with no row in any of these
-- tables must be indistinguishable from one who has never heard of it.

-- ---------------------------------------------------------------------------
-- 1. THE CONNECTION'S METADATA. Client-readable, and holds no secret.
--
-- Split from the access token on purpose, which is the apple_tokens
-- lesson applied before it bites: the client genuinely needs the bank
-- name, the last sync time and the status to draw the Checking pill,
-- and the moment those live in the same row as the token, "can the
-- client read this table" stops having a simple answer.
create table if not exists plaid_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- Plaid's own id for the Item. Unique across the whole table: one
  -- Item belongs to one user, and a webhook arrives knowing only this.
  plaid_item_id   text not null unique,
  institution_id   text,
  institution_name text,
  -- 'ok' | 'login_required' | 'error'. `login_required` is the one the
  -- UI must act on: ITEM_LOGIN_REQUIRED and its relatives mean the
  -- balance is frozen, and a frozen number that looks live is worse
  -- than no number at all.
  status          text not null default 'ok',
  last_error_code text,
  -- The staleness clock. PER ITEM, not per device, so one pull serves
  -- every device the user is signed in on — which is the whole reason
  -- the check lives server-side.
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ONE CONNECTION PER USER, AND IT IS AN INDEX RATHER THAN A SHAPE.
--
-- The limit is today's product decision (single-account select in
-- Link), not a fact about the data: savings and brokerage are a
-- plausible next step. Every table here is already keyed to allow
-- many, so lifting the limit is `drop index plaid_items_one_per_user`
-- and nothing else. Writing it as a primary key on user_id would have
-- been simpler today and a migration later.
create unique index if not exists plaid_items_one_per_user on plaid_items (user_id);

alter table plaid_items enable row level security;

-- The client may READ its own connection, and may not write one. Every
-- write happens in an edge function holding the service role key,
-- because every write is the consequence of a call to Plaid — there is
-- no such thing as a connection this app knows about and Plaid does
-- not.
drop policy if exists "see own plaid item" on plaid_items;
create policy "see own plaid item"
  on plaid_items for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. THE ACCOUNT UNDER IT. Client-readable; also no secret.
--
-- A separate table from the Item for the expansion reason above: one
-- Item can carry a checking account and later a savings one, and the
-- day that happens this table grows rows rather than the other one
-- growing columns.
create table if not exists plaid_accounts (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references plaid_items(id) on delete cascade,
  -- Denormalized from the Item so a select policy can be written
  -- against this table without a join. The cascade above keeps it
  -- honest.
  user_id          uuid not null references auth.users(id) on delete cascade,
  plaid_account_id text not null,
  name             text,
  -- The last four digits, which is all Plaid gives and all anyone
  -- needs. NOT the account number: see the note on `plaid_tokens`.
  mask             text,
  type             text,
  subtype          text,
  -- Which account the forecast's checking balance comes from. One
  -- true row per user today; the column is here so that stays true
  -- when there is more than one account.
  is_checking      boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (item_id, plaid_account_id)
);

alter table plaid_accounts enable row level security;

drop policy if exists "see own plaid accounts" on plaid_accounts;
create policy "see own plaid accounts"
  on plaid_accounts for select
  to authenticated
  using (auth.uid() = user_id);

-- THE LAST NUMBERS PLAID GAVE US, both of them.
--
-- The forecast uses AVAILABLE and the user is shown AVAILABLE, full
-- stop — "current" and "available" are a distinction banks make and
-- people do not, and showing both invites the question "which one is
-- my money". Available already nets pending holds, which is nearer to
-- what the next two weeks can spend.
--
-- `last_current` is kept anyway, here and nowhere the UI can reach,
-- because the day a number looks wrong the first question is "wrong
-- compared to what" and the answer has to exist.
alter table plaid_accounts add column if not exists last_available  numeric;
alter table plaid_accounts add column if not exists last_current    numeric;
alter table plaid_accounts add column if not exists last_balance_at timestamptz;

-- THE USER'S TIMEZONE, remembered on the Item.
--
-- A pulled balance is dated in the user's own day, not the server's
-- — a pull at 8:46 PM Eastern belongs to that evening, not to the
-- UTC tomorrow that has already started. The client sends its IANA
-- zone with every pull and it is kept here for the pulls that have
-- no client to ask: the plan-aware morning pulls in the roadmap, and
-- anything else that ever runs from cron.
--
-- A ZONE NAME, NOT A DATE, because a client that sent a date could
-- send any date and the snapshot date is the forecast's anchor.
alter table plaid_items add column if not exists time_zone text;

-- ---------------------------------------------------------------------------
-- 2b. THE LINK SESSION, which is how a Hosted Link connection gets home.
--
-- Hosted Link has NO frontend callback: Link runs on a Plaid-hosted
-- page, and the public_token arrives server-side through the
-- SESSION_FINISHED webhook. The webhook names a link_token, so
-- something has to know which user that link_token was minted for.
-- This table is that something.
--
-- WHY A FORGED WEBHOOK CANNOT DO ANYTHING. The webhook body is treated
-- as a TRIGGER AND NOTHING ELSE: nothing in it is stored, and the
-- handler re-asks Plaid what happened via /link/token/get using the
-- link_token from THIS table. Someone who guesses a link_token can
-- cause us to ask Plaid a question about our own session. They cannot
-- tell us the answer.
create table if not exists plaid_link_sessions (
  link_token text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Plaid's link tokens are short-lived; this is ours, so a session
  -- that was abandoned cannot be replayed a week later.
  expires_at timestamptz not null default now() + interval '4 hours',
  used_at    timestamptz
);

alter table plaid_link_sessions enable row level security;
revoke all on table plaid_link_sessions from anon, authenticated;

create index if not exists plaid_link_sessions_open
  on plaid_link_sessions (expires_at) where used_at is null;

-- ---------------------------------------------------------------------------
-- 3. THE ACCESS TOKEN. ENCRYPTED AT REST, and RLS on with NO POLICIES.
--
-- TWO LOCKS, NOT ONE, on the owner's call 2026-10-20. RLS answers
-- "can a client read this row". Encryption answers the question RLS
-- cannot: what a database backup, a disk image, a logged statement or
-- a mistaken `select *` by someone with the service role actually
-- contains. A Plaid access token is a standing credential against
-- somebody's bank, and it is the one value in this project where
-- "behind a policy" is not the same as "safe".
--
-- SO THIS TABLE HOLDS NO TOKEN. It holds a Vault secret id. The
-- ciphertext lives in `vault.secrets`, the key is not readable from
-- SQL, and the only way back to plaintext is `plaid_read_token`
-- below — which the service role calls and nothing else can.
--
-- WHY create_secret() AND NEVER A PLAIN INSERT: Supabase logs
-- statements by default, so an `insert into vault.secrets (secret)
-- values ('access-sandbox-...')` writes the token to the logs in
-- clear. The function exists to avoid exactly that, and every write
-- below goes through it.
--
-- WHAT IS NOT IN HERE, and must never be: an account number or a
-- routing number. The Link token asks for one product so that Balance
-- can be initialized at all (Plaid does not accept `balance` in the
-- products array), and that product's data is never fetched — no call
-- to /auth/get, no call to /identity/get, nothing stored from either.
create extension if not exists supabase_vault with schema vault;

create table if not exists plaid_tokens (
  item_id    uuid primary key references plaid_items(id) on delete cascade,
  -- Points into vault.secrets. NOT a foreign key: the Vault is not
  -- ours to constrain, and an Item deleted before its secret is
  -- cleaned up must not be blocked by a reference.
  secret_id  uuid not null,
  updated_at timestamptz not null default now()
);

-- Migrating a project that already ran an earlier copy of this file,
-- when `access_token text` was the column. Nothing has shipped on it,
-- so there is nothing to move — but dropping it is the one statement
-- that makes "no plaintext token exists anywhere" true rather than
-- true of new rows.
alter table plaid_tokens add column if not exists secret_id uuid;
alter table plaid_tokens drop column if exists access_token;

alter table plaid_tokens enable row level security;
revoke all on table plaid_tokens from anon, authenticated;

-- Store a token. Called once per Item, by the service role, through
-- an RPC — the plaintext exists in the edge function's memory and in
-- this call's arguments, and nowhere else, ever.
create or replace function plaid_store_token(p_item_id uuid, p_access_token text)
returns void as $$
declare
  sid uuid;
begin
  sid := vault.create_secret(
    p_access_token,
    'plaid_item_' || p_item_id::text,
    'Plaid access token (balance only). Delete with the Item.');
  insert into plaid_tokens (item_id, secret_id) values (p_item_id, sid)
    on conflict (item_id) do update set secret_id = excluded.secret_id, updated_at = now();
end;
$$ language plpgsql security definer set search_path = public, vault;

-- Read one back. The ONLY path from ciphertext to plaintext in this
-- project, which is what makes it worth being a named function rather
-- than a join somebody writes twice.
create or replace function plaid_read_token(p_item_id uuid)
returns text as $$
  select s.decrypted_secret
    from plaid_tokens t
    join vault.decrypted_secrets s on s.id = t.secret_id
   where t.item_id = p_item_id;
$$ language sql security definer set search_path = public, vault;

-- Forget one. Deleting the plaid_items row cascades the pointer away
-- and would leave the ciphertext behind for ever, which is a deleted
-- credential that still exists.
create or replace function plaid_forget_token(p_item_id uuid)
returns void as $$
begin
  delete from vault.secrets
   where id = (select secret_id from plaid_tokens where item_id = p_item_id);
end;
$$ language plpgsql security definer set search_path = public, vault;


-- ---------------------------------------------------------------------------
-- 4. THE REMOVAL QUEUE. Holds the TOKEN, not the user id.
--
-- Exactly the apple_revocations shape and for exactly the apple
-- reason: deleting the auth.users row cascades plaid_tokens away, so
-- anything that looked the token up AFTER the delete would find
-- nothing. The token is copied in here inside the same statement that
-- deletes the user, and this table has no foreign key, so it survives
-- the cascade.
--
-- Draining it calls /item/remove, which is what actually ends Plaid's
-- access to the bank. Deleting our row alone would leave the Item live
-- at Plaid — our record gone and the connection standing, which is the
-- worst of both.
create table if not exists plaid_removals (
  id            bigserial primary key,
  -- The Vault secret, same as plaid_tokens. Nullable because it is
  -- deleted on success: the row stays as the record that the removal
  -- happened, and the credential does not.
  secret_id     uuid,
  -- Kept for the log and for support: /item/remove answers by token,
  -- but "which Item was this" has no answer afterwards otherwise.
  plaid_item_id text,
  queued_at     timestamptz not null default now(),
  removed_at    timestamptz,
  attempts      integer not null default 0,
  last_attempt_at timestamptz,
  last_error    text
);

alter table plaid_removals enable row level security;
revoke all on table plaid_removals from anon, authenticated;

create index if not exists plaid_removals_pending
  on plaid_removals (queued_at) where removed_at is null;

-- Same migration note as plaid_tokens: an earlier copy of this file
-- had `access_token text not null` here.
alter table plaid_removals add column if not exists secret_id uuid;
alter table plaid_removals drop column if exists access_token;

-- ONE PENDING ROW PER TOKEN, the lesson already paid for once on
-- apple_revocations: two concurrent purges see the same snapshot and
-- queue the same token twice.
create unique index if not exists plaid_removals_one_pending
  on plaid_removals (secret_id) where removed_at is null;

-- THE SAFETY NET, and it is armed BEFORE it is needed.
--
-- The window this closes: `/item/public_token/exchange` succeeds, so
-- Plaid now believes this app has standing access to somebody's
-- bank — and then the Item row, or the token row, fails to store, or
-- the function is killed between the two. The access token existed
-- only in that function's memory. Plaid has a live Item; we have no
-- record of it; nothing will ever remove it. That is the one state
-- this feature must never reach in production, because nobody can
-- clean up what nobody knows about.
--
-- Per-branch cleanup does not close it, which is what the first
-- version tried: every `if (error)` can queue a removal and a
-- process that dies has no branch to be in.
--
-- So the removal is queued the instant the exchange returns, before
-- anything else is attempted, and CANCELED once the Item and token
-- are safely stored. Nothing to remember, nothing to catch: if the
-- happy path does not reach its last line, the drain removes the
-- Item within the hour. Returns the row id, which is what canceling
-- it needs.
--
-- Dropped first because CREATE OR REPLACE cannot change a function's
-- return type, and this one returned void until 2026-10-20.
drop function if exists plaid_queue_removal(text, text);
drop function if exists plaid_queue_removal(text, text, text);
create or replace function plaid_queue_removal(
  p_access_token text, p_plaid_item_id text, p_env text default 'production'
)
returns bigint as $$
declare
  sid uuid;
  rid bigint;
begin
  sid := vault.create_secret(
    p_access_token,
    'plaid_removal_' || gen_random_uuid()::text,
    'Plaid access token awaiting /item/remove.');
  -- THE ENVIRONMENT TRAVELS WITH THE TOKEN. The drain runs an hour
  -- later, long after plaid_items is gone, and a sandbox token sent
  -- to production.plaid.com fails every retry forever — nothing in
  -- this queue gives up.
  insert into plaid_removals (secret_id, plaid_item_id, env)
    values (sid, p_plaid_item_id, p_env)
    returning id into rid;
  return rid;
end;
$$ language plpgsql security definer set search_path = public, vault;

-- Stand the net down. Called once the Item and its token are stored,
-- which is the moment an orphan stops being possible.
create or replace function plaid_cancel_removal(p_id bigint)
returns void as $$
begin
  delete from vault.secrets
   where id = (select secret_id from plaid_removals where id = p_id and removed_at is null);
  delete from plaid_removals where id = p_id and removed_at is null;
end;
$$ language plpgsql security definer set search_path = public, vault;

create or replace function plaid_read_removal_token(p_id bigint)
returns text as $$
  select s.decrypted_secret
    from plaid_removals r
    join vault.decrypted_secrets s on s.id = r.secret_id
   where r.id = p_id;
$$ language sql security definer set search_path = public, vault;

-- On a successful /item/remove the ciphertext goes and the ROW STAYS,
-- so "did we actually remove this" keeps an answer. Same shape as
-- apple_revocations blanking its token column.
create or replace function plaid_finish_removal(p_id bigint)
returns void as $$
begin
  delete from vault.secrets where id = (select secret_id from plaid_removals where id = p_id);
  update plaid_removals set removed_at = now(), secret_id = null, last_error = null where id = p_id;
end;
$$ language plpgsql security definer set search_path = public, vault;

-- NONE OF THESE ARE CALLABLE BY A CLIENT. Each takes an id as an
-- argument, which is exactly the shape that must never be reachable
-- from a browser with the anon key.
revoke all on function plaid_store_token(uuid, text)        from public, anon, authenticated;
revoke all on function plaid_read_token(uuid)               from public, anon, authenticated;
revoke all on function plaid_forget_token(uuid)             from public, anon, authenticated;
revoke all on function plaid_queue_removal(text, text, text) from public, anon, authenticated;
revoke all on function plaid_cancel_removal(bigint)        from public, anon, authenticated;
revoke all on function plaid_read_removal_token(bigint)     from public, anon, authenticated;
revoke all on function plaid_finish_removal(bigint)         from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE CALL LOG. Every request this app makes to Plaid, server-side.
--
-- Asked for so that "pulls per user per month" is a query rather than
-- a guess, which matters while the plan is a Trial with ten
-- connections and a bill attached to call volume.
--
-- NO BALANCE IN HERE. The log records that a call happened, not what
-- it returned. A log that quietly accumulates financial history is a
-- second copy of the thing this feature promised not to keep.
create table if not exists plaid_api_log (
  id          bigserial primary key,
  -- NOT a foreign key, and not cascaded: the log outlives the account
  -- on purpose, because "how many calls did we make last month" must
  -- survive someone deleting their account. It is a user id and a
  -- timestamp, which is also why there is nothing else in the row.
  user_id     uuid,
  called_at   timestamptz not null default now(),
  -- 'open' | 'refresh' | 'connect' | 'disconnect' | 'webhook'
  trigger     text not null,
  endpoint    text not null,
  ok          boolean not null,
  error_code  text,
  duration_ms integer
);

alter table plaid_api_log enable row level security;
revoke all on table plaid_api_log from anon, authenticated;

create index if not exists plaid_api_log_by_user on plaid_api_log (user_id, called_at desc);

-- ---------------------------------------------------------------------------
-- 5a. THE SLOT LEDGER. Append-only, and the one number the Trial plan
-- makes expensive to guess.
--
-- PLAID'S TRIAL IS TEN PRODUCTION ITEMS EVER (support.plaid.com, read
-- by the owner 2026-10-21). There is no time limit and there is no
-- refund: `/item/remove` does NOT give a slot back, and two Items for
-- the same bank account count as two. So "how many have we spent" is
-- not answerable from `plaid_items` — that table holds the LIVE ones,
-- and it is emptied by every disconnect.
--
-- Hence a second table that nothing ever deletes from. One row per
-- Item successfully created at Plaid.
--
-- NO USER ID IN IT. The question is "how many of the ten are gone",
-- which needs a count, an environment and a date — not a person. A
-- ledger that outlives accounts on purpose is exactly the kind of
-- table that should not carry one, and leaving it out means there is
-- nothing for account deletion to have to remember to purge.
create table if not exists plaid_item_creations (
  id               bigserial primary key,
  -- Plaid's own id for the Item. Not personal, and it is what makes a
  -- duplicate visible as a duplicate.
  plaid_item_id    text,
  institution_name text,
  -- 'sandbox' | 'production'. SANDBOX ITEMS DO NOT COST A SLOT, and
  -- the whole point of the count is to not confuse the two.
  env              text not null,
  created_at       timestamptz not null default now()
);

alter table plaid_item_creations enable row level security;
revoke all on table plaid_item_creations from anon, authenticated;

create index if not exists plaid_item_creations_by_env
  on plaid_item_creations (env, created_at desc);

-- ---------------------------------------------------------------------------
-- 5b. THE ENVIRONMENT, PER ITEM — not per project (2026-10-21).
--
-- `PLAID_ENV` was a single secret for the whole project, which made
-- sandbox testing and a live connection mutually exclusive: flipping
-- it pointed a real access token at the wrong host and every pull
-- failed. An access token BELONGS TO the environment it was minted
-- in. It is a property of the Item, so it lives on the Item, and
-- `readConfig(env)` picks the matching secret.
--
-- Three places need it, each for its own reason:
--   plaid_items          -- every call about an existing connection
--   plaid_link_sessions  -- pinned at mint, so a session that outlives
--                           a change of default still finishes in the
--                           environment it started in
--   plaid_removals       -- the drain runs long after the Item's row
--                           is gone and must still pick credentials
--
-- BACKFILLED TO 'production', which is correct and not a guess: the
-- only Item that existed when this ran was the owner's real TD Bank
-- connection, and every sandbox Item had already been removed.
alter table plaid_items         add column if not exists env text;
alter table plaid_link_sessions add column if not exists env text;
alter table plaid_removals      add column if not exists env text;

update plaid_items         set env = 'production' where env is null;
update plaid_link_sessions set env = 'production' where env is null;
update plaid_removals      set env = 'production' where env is null;

-- WHICH ENVIRONMENT A PERSON'S NEXT CONNECTION IS MADE IN.
--
-- On the allowlist, because the allowlist is already the list of who
-- may connect at all — "and in which environment" is the same kind
-- of fact, decided by hand, for the same ten people. A null means
-- the project default (PLAID_ENV), so existing rows keep behaving
-- exactly as they did.
alter table plaid_beta add column if not exists env text;

-- The test account connects against sandbox; everyone else against
-- production. Set by hand, one row at a time:
--   update plaid_beta set env = 'sandbox'
--    where user_id = (select id from auth.users where email = '<test address>');
--   update plaid_beta set env = 'production'
--    where user_id = (select id from auth.users where email = '<real address>');

-- ---------------------------------------------------------------------------
-- 6. THE BETA ALLOWLIST.
--
-- Trial is ten connections, so the toggle is not offered to everyone.
-- The client READS its own row to decide whether to draw the
-- "Connected features" switch at all, and can write nothing: an
-- allowlist a client can add itself to is a decoration.
--
-- A user who is not on it must not be able to tell the difference
-- between "not allowlisted" and "feature does not exist", which an
-- empty read gives for free.
create table if not exists plaid_beta (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  note      text
);

alter table plaid_beta enable row level security;

drop policy if exists "see own beta row" on plaid_beta;
create policy "see own beta row"
  on plaid_beta for select
  to authenticated
  using (auth.uid() = user_id);

-- Adding a tester, by hand, from the SQL editor:
--   insert into plaid_beta (user_id, note)
--   select id, 'TestFlight, asked 2026-10-20' from auth.users where email = '...';
-- And the count against the ten Trial slots:
--   select count(*) from plaid_items;

-- ---------------------------------------------------------------------------
-- 7. THE PURGE, with the removal queued in front of the delete.
--
-- Replaces the version in apple_tokens.sql, which itself replaced the
-- one in account_deletion.sql. STILL ONE STATEMENT, so there is still
-- no way to half-delete someone: both queue inserts and the user
-- delete are the same CTE and the same transaction.
--
-- Read the three CTEs as the three promises deletion makes: Apple's
-- grant is revoked, Plaid's Item is removed, and the user is gone.
create or replace function purge_due_accounts() returns integer as $$
declare
  purged integer;
begin
  with due as (
    select user_id from account_deletions where purge_after <= now()
  ), queued_apple as (
    insert into apple_revocations (refresh_token)
    select t.refresh_token from apple_tokens t join due on t.user_id = due.user_id
    on conflict (refresh_token) where revoked_at is null do nothing
    returning 1
  ), queued_plaid as (
    -- THE SECRET ID MOVES, NOT THE TOKEN. vault.secrets has no
    -- foreign key to auth.users, so the ciphertext survives the
    -- cascade that takes plaid_tokens away — which is the only
    -- reason the drain can still call /item/remove afterwards.
    -- AND ITS ENVIRONMENT, carried off the Item before the Item
    -- goes: the drain runs an hour later with no row left to ask.
    insert into plaid_removals (secret_id, plaid_item_id, env)
    select tok.secret_id, it.plaid_item_id, coalesce(it.env, 'production')
      from plaid_tokens tok
      join plaid_items it on it.id = tok.item_id
      join due on it.user_id = due.user_id
    on conflict (secret_id) where removed_at is null do nothing
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
-- 8. WRITING A PULLED BALANCE — and the collision rule, in SQL.
--
-- A pulled balance is an ORDINARY accountSnapshot. The Ledger, the
-- Calendar and history know nothing about Plaid and never will; they
-- read the same date-keyed row a Log balance sheet writes. That is the
-- whole integration, and it is why this feature cannot drift away from
-- the manual one: there is only one kind of balance.
--
-- THE SAME-DATE COLLISION LIVES HERE, in one statement, rather than in
-- an edge function that reads and then writes. budget_entities keys
-- snapshots by date — `<accountId>:<YYYY-MM-DD>` is the primary key —
-- so a pull and a manual log on the same day are not two rows to
-- arbitrate between. They are the same row, and somebody has to lose.
--
-- MANUAL WINS. A snapshot is a statement about a date, and a manual
-- log is the USER'S statement where a pull is the APP'S. Overwriting
-- the first with the second discards something a person deliberately
-- typed, silently, on the most common evening there is: you log a
-- balance knowing a check has not cleared, the app opens at eleven and
-- pulls, and your number is gone with no event anywhere to tell you.
-- The rule costs at most a day — tomorrow's pull has a newer date and
-- takes over with nothing to undo.
--
-- A ROW WITH NO `source` IS MANUAL, which is every snapshot written
-- before this feature existed. `coalesce(..., 'manual')` is doing real
-- work and is not defensive habit.
--
-- A TOMBSTONE ALSO WINS. If the user deleted that date's snapshot, a
-- pull does not resurrect it; deleting is a statement too, and the
-- next day's pull is along shortly.
--
-- Returns 'written' or 'kept_manual' so the caller can say "logged
-- today" on the pill instead of pretending it synced.
-- Dropped explicitly: adding a parameter makes a NEW function rather
-- than replacing this one, and two overloads would leave which one
-- runs up to argument inference.
drop function if exists plaid_write_balance(uuid, text, text, numeric, text);
create or replace function plaid_write_balance(
  p_user_id     uuid,
  p_account_id  text,
  p_date        text,
  p_amount      numeric,
  p_external_id text,
  -- "Use bank balance": the user has ASKED for the bank's number to
  -- replace the one they typed, so the guard below steps aside. It is
  -- the same rule, not an exception to it — manual wins because the
  -- user's intent wins, and this is the user saying otherwise.
  p_force       boolean default false
) returns text as $$
declare
  wrote boolean;
begin
  insert into budget_entities (user_id, kind, entity_id, data, schema_version)
  values (
    p_user_id, 'accountSnapshot', p_account_id || ':' || p_date,
    jsonb_build_object(
      'accountId',  p_account_id,
      'id',         p_account_id || ':' || p_date,
      'date',       p_date,
      'amount',     p_amount,
      'source',     'plaid',
      'externalId', p_external_id
    ),
    1
  )
  on conflict (user_id, kind, entity_id) do update
    set data       = excluded.data,
        version    = budget_entities.version + 1,
        updated_at = now()
  where budget_entities.deleted_at is null
    and (p_force or coalesce(budget_entities.data->>'source', 'manual') = 'plaid')
  returning true into wrote;

  return case when wrote then 'written' else 'kept_manual' end;
end;
$$ language plpgsql security definer set search_path = public;

-- Only the service role calls it. It takes a user id as an argument,
-- which is exactly the shape a client must never be able to invoke.
revoke all on function plaid_write_balance(uuid, text, text, numeric, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. CLAIMING A PULL, so two callers cannot both make one.
--
-- ONE CONNECT PRODUCED TWO BILLED PULLS on 2026-10-20: the connect
-- flow pulled as soon as the Item existed, and the app's own
-- pull-on-open fired three seconds later when the page noticed a
-- connection had appeared. Both read `last_synced_at`, both saw it
-- empty, and both called Plaid.
--
-- The client half of that is fixed by not asking twice. This is the
-- half that cannot be got wrong: the staleness test and the write
-- that satisfies it are ONE statement, so the second caller's UPDATE
-- matches no row and it is told the balance is fresh. That also
-- makes the promise in §10 true rather than approximately true —
-- "one pull serves every device" has to survive two phones opening
-- the app in the same second.
--
-- Returns the PREVIOUS last_synced_at when the claim succeeds, so a
-- failed pull can put it back: claiming writes `now()` up front, and
-- a pull that then fails must not leave the Item looking synced.
create or replace function plaid_claim_pull(p_item_id uuid, p_min_seconds integer)
returns table (claimed boolean, previous timestamptz) as $$
begin
  return query
  with before as (select last_synced_at from plaid_items where id = p_item_id)
  update plaid_items i
     set last_synced_at = now(), updated_at = now()
    from before
   where i.id = p_item_id
     and (i.last_synced_at is null
          or i.last_synced_at < now() - make_interval(secs => p_min_seconds))
  returning true, before.last_synced_at;
end;
$$ language plpgsql security definer set search_path = public;

-- Put the clock back after a pull that did not happen.
create or replace function plaid_release_pull(p_item_id uuid, p_previous timestamptz)
returns void as $$
  update plaid_items set last_synced_at = p_previous where id = p_item_id;
$$ language sql security definer set search_path = public;

revoke all on function plaid_claim_pull(uuid, integer)        from public, anon, authenticated;
revoke all on function plaid_release_pull(uuid, timestamptz)  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- DRAINING THE REMOVAL QUEUE. The half that was missing on the Apple
-- side for a month, written down here before it can be missing twice.
--
--   select cron.schedule('drain-plaid-removals', '43 * * * *', $$
--     select net.http_post(
--       url     := 'https://kjcvtpmorftjyejjskwm.supabase.co/functions/v1/plaid-disconnect',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' ||
--           (select decrypted_secret from vault.decrypted_secrets
--             where name = 'service_role_key')),
--       body    := '{"drain":true}'::jsonb
--     );
--   $$);
--
-- The key must be the legacy `eyJ...` service_role JWT, not an
-- `sb_secret_...` one — see apple_tokens.sql for the measurement.
--
-- Is the queue empty?
--   select count(*) filter (where removed_at is null) as pending,
--          count(*) filter (where removed_at is not null) as done
--     from plaid_removals;

-- ---------------------------------------------------------------------------
-- PROVE THE LOCK RATHER THAN TRUSTING IT.
--
-- The two tables that must have rls_enabled = true and policies = 0 —
-- policies, not "no policies I remember writing":
--
--   select c.relname                                   as table_name,
--          c.relrowsecurity                            as rls_enabled,
--          (select count(*) from pg_policies p
--             where p.schemaname = 'public' and p.tablename = c.relname) as policies
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('plaid_tokens', 'plaid_removals', 'plaid_api_log',
--                        'plaid_link_sessions', 'plaid_item_creations');
--
-- And the three that are client-readable, which must have exactly one
-- SELECT policy each and no INSERT, UPDATE or DELETE policy at all:
--
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('plaid_items', 'plaid_accounts', 'plaid_beta')
--    order by tablename, cmd;
--
-- And the grants, the other half:
--
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_name in ('plaid_tokens', 'plaid_removals', 'plaid_api_log')
--      and grantee in ('anon', 'authenticated');   -- expect zero rows
--
-- AND THE ENCRYPTION, which is the claim worth proving rather than
-- assuming. CONFIRM THE VIEW'S COLUMN NAMES ON FIRST RUN — this file
-- was written against the documented `vault.decrypted_secrets
-- (id, decrypted_secret)` and has not yet been run against the
-- project:
--
--   \d vault.decrypted_secrets
--
-- Then, after the first sandbox connection, the question that
-- matters: is there a token anywhere in clear?
--
--   select * from plaid_tokens;              -- a uuid, no token
--   select id, name, secret from vault.secrets;  -- ciphertext only
--   select plaid_read_token((select item_id from plaid_tokens limit 1));
--                                            -- the only way back
--
-- A third thing to turn off while testing, from Supabase's own Vault
-- guide: statement logging. A logged INSERT would put the plaintext
-- in the logs, which is the reason create_secret() exists.
