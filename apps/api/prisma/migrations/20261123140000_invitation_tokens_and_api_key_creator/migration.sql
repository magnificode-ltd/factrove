-- Invitation secrets and the membership that created an API key.
-- Idempotent: a second run keeps matching keys, leaves organizations and
-- artifacts in place, and does not choose among duplicate memberships.
--
-- Lock order, held until this transaction commits:
-- 1. artifact ACCESS EXCLUSIVE
-- 2. user rows FOR UPDATE, in id order
-- 3. organization SHARE ROW EXCLUSIVE
-- 4. member ACCESS EXCLUSIVE
-- 5. invitation ACCESS EXCLUSIVE
-- 6. apikey ACCESS EXCLUSIVE, then the data changes
--
-- ACCESS EXCLUSIVE on artifact comes first so an upload cannot hold
-- ROW EXCLUSIVE on artifact and then wait on a user or organization row
-- while this migration already holds those locks. Every user row is locked
-- before organization, member, and invitation so a create that already holds
-- a user row cannot wait on a row this migration inserts. Apikey is last so
-- a key created during the migration waits until createdByMemberId is written
-- or the unmatched secret is invalidated.

CREATE OR REPLACE FUNCTION factrove_invitation_tokens_and_api_key_creator() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  user_row record;
  key_row record;
  duplicate_report text;
  unknown_invitations text;
  bad_hashes text;
  meta jsonb;
  creator text;
  member_id text;
  member_count integer;
  next_metadata text;
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
  LOCK TABLE member IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE invitation IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE apikey IN ACCESS EXCLUSIVE MODE;

  ALTER TABLE invitation ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;
  ALTER TABLE invitation ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3);

  SELECT coalesce(string_agg(
    format(
      'organization %s user %s members %s',
      grouped.organization_id,
      grouped.user_id,
      grouped.member_list
    ),
    E'\n' ORDER BY grouped.organization_id, grouped.user_id
  ), '')
  INTO duplicate_report
  FROM (
    SELECT
      "organizationId" AS organization_id,
      "userId" AS user_id,
      string_agg(format('%s (role %s)', id, role), ', ' ORDER BY id) AS member_list
    FROM member
    GROUP BY "organizationId", "userId"
    HAVING count(*) > 1
  ) AS grouped;

  IF duplicate_report <> '' THEN
    RAISE EXCEPTION 'duplicate memberships: % Refusing to choose a role. Remove the extra member rows and run the migration again.', duplicate_report;
  END IF;

  SELECT coalesce(string_agg(format('invitation %s status %s', id, status), ', ' ORDER BY id), '')
  INTO unknown_invitations
  FROM invitation
  WHERE status NOT IN ('pending', 'accepted', 'canceled', 'expired');

  IF unknown_invitations <> '' THEN
    RAISE EXCEPTION 'invitation status is not pending, accepted, canceled, or expired: %. Refusing to guess a status.', unknown_invitations;
  END IF;

  SELECT coalesce(string_agg(id, ', ' ORDER BY id), '')
  INTO bad_hashes
  FROM invitation
  WHERE "tokenHash" IS NOT NULL
    AND "tokenHash" !~ '^[0-9a-f]{64}$';

  IF bad_hashes <> '' THEN
    RAISE EXCEPTION 'invitation tokenHash is not a SHA-256 hex digest: %', bad_hashes;
  END IF;

  -- Plugin rows and any other pending invitation without a secret cannot be
  -- accepted. Cancel them instead of inventing a hash.
  UPDATE invitation
  SET status = 'canceled',
      "tokenHash" = NULL
  WHERE status = 'pending'
    AND "tokenHash" IS NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'member_organizationId_userId_key'
      AND conrelid = 'member'::regclass
  ) THEN
    ALTER TABLE member
      ADD CONSTRAINT "member_organizationId_userId_key"
      UNIQUE ("organizationId", "userId");
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS "invitation_tokenHash_key" ON invitation ("tokenHash");

  CREATE UNIQUE INDEX IF NOT EXISTS "invitation_pending_email_key"
    ON invitation ("organizationId", lower(email))
    WHERE status = 'pending';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invitation_token_hash_status_check'
      AND conrelid = 'invitation'::regclass
  ) THEN
    ALTER TABLE invitation
      ADD CONSTRAINT invitation_token_hash_status_check
      CHECK (
        (
          status = 'pending'
          AND "tokenHash" IS NOT NULL
          AND "tokenHash" ~ '^[0-9a-f]{64}$'
        )
        OR (
          status IN ('accepted', 'canceled', 'expired')
          AND "tokenHash" IS NULL
        )
      );
  END IF;

  FOR key_row IN
    SELECT
      id,
      "referenceId" AS reference_id,
      metadata,
      "key" AS key_digest,
      enabled
    FROM apikey
    ORDER BY id
  LOOP
    meta := NULL;
    BEGIN
      IF key_row.metadata IS NOT NULL AND btrim(key_row.metadata) <> '' THEN
        meta := key_row.metadata::jsonb;
        IF jsonb_typeof(meta) = 'string' THEN
          meta := (meta #>> '{}')::jsonb;
        END IF;
        IF jsonb_typeof(meta) IS DISTINCT FROM 'object' THEN
          meta := NULL;
        END IF;
      END IF;
    EXCEPTION WHEN others THEN
      meta := NULL;
    END;

    creator := NULL;
    IF meta IS NOT NULL THEN
      creator := NULLIF(meta->>'createdByUserId', '');
    END IF;

    member_id := NULL;
    member_count := 0;
    IF creator IS NOT NULL THEN
      SELECT count(*)::integer, min(member.id)
      INTO member_count, member_id
      FROM member
      WHERE member."userId" = creator
        AND member."organizationId" = key_row.reference_id;
    END IF;

    -- A replaced digest stays dead. A later membership must not receive it.
    IF member_count = 1
      AND member_id IS NOT NULL
      AND key_row.key_digest NOT LIKE 'invalidated:%'
    THEN
      next_metadata := jsonb_build_object(
        'createdByUserId', creator,
        'createdByMemberId', member_id
      )::text;
      IF meta IS NULL
        OR meta->>'createdByUserId' IS DISTINCT FROM creator
        OR meta->>'createdByMemberId' IS DISTINCT FROM member_id
        OR (SELECT count(*) FROM jsonb_object_keys(meta)) <> 2
      THEN
        UPDATE apikey
        SET metadata = next_metadata,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = key_row.id;
      END IF;
    ELSE
      IF creator IS NOT NULL THEN
        next_metadata := jsonb_build_object('createdByUserId', creator)::text;
      ELSE
        next_metadata := NULL;
      END IF;
      IF coalesce(key_row.enabled, true) IS DISTINCT FROM false
        OR key_row.key_digest IS DISTINCT FROM ('invalidated:' || key_row.id)
        OR key_row.metadata IS DISTINCT FROM next_metadata
      THEN
        UPDATE apikey
        SET enabled = false,
            "key" = 'invalidated:' || id,
            metadata = next_metadata,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = key_row.id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

SELECT factrove_invitation_tokens_and_api_key_creator();

DROP FUNCTION factrove_invitation_tokens_and_api_key_creator();
