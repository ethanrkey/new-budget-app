-- STEP 4 of the entity migration. Run this LAST, and only after
-- scripts/verify_entities.mjs has passed for every row.
--
-- After this, budget_states is a frozen point-in-time snapshot: readable,
-- unwritable. It IS the rollback, so keep it for at least a month.
--
-- Why a trigger and not a revoked grant: an old browser tab runs old code
-- and will keep trying to write the whole document. Silently letting it
-- succeed would fork the data — the blob would move while the entity rows
-- are authoritative, and nobody would notice until the two were compared.
-- Raising makes that tab fail loudly, and the client now surfaces a failed
-- save ("Your changes aren't being saved", with a Reload) instead of
-- swallowing it.

create or replace function budget_states_frozen() returns trigger as $$
begin
  raise exception
    'budget_states is frozen: this app version is out of date. Reload.'
    using errcode = 'read_only_sql_transaction';
end;
$$ language plpgsql;

drop trigger if exists budget_states_freeze on budget_states;
create trigger budget_states_freeze
  before insert or update or delete on budget_states
  for each row execute function budget_states_frozen();

-- TO ROLL BACK (within the retention window):
--   drop trigger budget_states_freeze on budget_states;
-- then point the client back at budget_states. Note what that costs: every
-- edit made AFTER cutover lives only in budget_entities and is not in the
-- frozen column. The phased rollout would have made rollback lossless; the
-- single pass trades that for not running a dual-write soak over a
-- divergence window with nobody in it. Deliberate — see PROJECT_SPEC §10.
