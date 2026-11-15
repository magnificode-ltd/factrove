-- API keys become organization-owned. Existing keys are user-owned and cannot
-- be retargeted, so this upgrade deletes every row. People create new keys.
-- Idempotent: a second run deletes nothing further and does not add the
-- foreign key again.
--
-- Lock order, held until this transaction commits. Same order as
-- factrove_backfill_organizations, then apikey:
-- 1. artifact ACCESS EXCLUSIVE
-- 2. user rows FOR UPDATE, in id order
-- 3. organization SHARE ROW EXCLUSIVE
-- 4. apikey ACCESS EXCLUSIVE, then DELETE, then the organization foreign key
--
-- ACCESS EXCLUSIVE on artifact comes first so an upload cannot hold
-- ROW EXCLUSIVE on artifact and then wait on FOR KEY SHARE of the creator
-- or the organization while this migration already holds those locks.
-- Every user row is locked before the organization lock so a create that
-- already holds a user row cannot wait on organization while this migration
-- waits on that user. API-key verification commits before the artifact
-- write, so it does not hold an apikey lock across that write. Apikey is
-- last.

CREATE OR REPLACE FUNCTION factrove_delete_api_keys() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  user_row record;
BEGIN
  LOCK TABLE artifact IN ACCESS EXCLUSIVE MODE;

  FOR user_row IN
    SELECT "user".id
    FROM "user"
    ORDER BY "user".id
  LOOP
    PERFORM 1
    FROM "user"
    WHERE "user".id = user_row.id
    FOR UPDATE;
  END LOOP;

  LOCK TABLE organization IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE apikey IN ACCESS EXCLUSIVE MODE;
  DELETE FROM apikey;
END;
$$;

SELECT factrove_delete_api_keys();

DROP FUNCTION factrove_delete_api_keys();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'apikey_referenceId_fkey'
      AND conrelid = 'apikey'::regclass
  ) THEN
    ALTER TABLE apikey
      ADD CONSTRAINT "apikey_referenceId_fkey"
      FOREIGN KEY ("referenceId") REFERENCES organization (id)
      ON DELETE RESTRICT;
  END IF;
END $$;
