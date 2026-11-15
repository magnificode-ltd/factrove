-- One organization for every user who has none, except local-user.
-- Idempotent: a user who already has a membership is skipped, and a second run
-- does not insert another organization. Slugs follow the same rules as
-- create-first-organization, including numeric suffixes and reserved words.

CREATE OR REPLACE FUNCTION factrove_is_trim_space(cp integer) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT cp IN (9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279)
      OR cp BETWEEN 8192 AND 8202;
$$;

CREATE OR REPLACE FUNCTION factrove_trim(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  length integer := char_length(value);
  start_at integer := 1;
  end_at integer := length;
BEGIN
  IF value IS NULL THEN
    RETURN '';
  END IF;
  WHILE start_at <= end_at AND factrove_is_trim_space(ascii(substr(value, start_at, 1))) LOOP
    start_at := start_at + 1;
  END LOOP;
  WHILE end_at >= start_at AND factrove_is_trim_space(ascii(substr(value, end_at, 1))) LOOP
    end_at := end_at - 1;
  END LOOP;
  IF start_at > end_at THEN
    RETURN '';
  END IF;
  RETURN substr(value, start_at, end_at - start_at + 1);
END;
$$;

CREATE OR REPLACE FUNCTION factrove_has_forbidden_name_char(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  index integer;
  code_point integer;
BEGIN
  FOR index IN 1..char_length(value) LOOP
    code_point := ascii(substr(value, index, 1));
    IF code_point <= 31 OR (code_point >= 127 AND code_point <= 159) OR code_point IN (8232, 8233) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- NFC, reject controls before trimming, then 1 to 80 code points. Null means invalid.
CREATE OR REPLACE FUNCTION factrove_normalize_organization_name(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  normalized text := normalize(coalesce(value, ''), NFC);
  trimmed text;
BEGIN
  IF factrove_has_forbidden_name_char(normalized) THEN
    RETURN NULL;
  END IF;
  trimmed := factrove_trim(normalized);
  IF char_length(trimmed) < 1 OR char_length(trimmed) > 80 THEN
    RETURN NULL;
  END IF;
  RETURN trimmed;
END;
$$;

CREATE OR REPLACE FUNCTION factrove_backfill_display_name(user_name text, email text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  base text := factrove_trim(coalesce(user_name, ''));
  candidate text;
  normalized text;
BEGIN
  IF base = '' THEN
    base := factrove_trim(split_part(coalesce(email, ''), '@', 1));
  END IF;
  IF base = '' THEN
    RETURN 'Organization';
  END IF;
  candidate := base || '''s organization';
  normalized := factrove_normalize_organization_name(candidate);
  IF normalized IS NULL THEN
    RETURN 'Organization';
  END IF;
  RETURN normalized;
END;
$$;

CREATE OR REPLACE FUNCTION factrove_is_combining_mark(cp integer) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT cp BETWEEN 768 AND 879
      OR cp BETWEEN 1155 AND 1161
      OR cp BETWEEN 1425 AND 1469
      OR cp BETWEEN 1471 AND 1471
      OR cp BETWEEN 1473 AND 1474
      OR cp BETWEEN 1476 AND 1477
      OR cp BETWEEN 1479 AND 1479
      OR cp BETWEEN 1552 AND 1562
      OR cp BETWEEN 1611 AND 1631
      OR cp BETWEEN 1648 AND 1648
      OR cp BETWEEN 1750 AND 1764
      OR cp BETWEEN 1759 AND 1764
      OR cp BETWEEN 1767 AND 1768
      OR cp BETWEEN 1770 AND 1773
      OR cp BETWEEN 1809 AND 1809
      OR cp BETWEEN 1840 AND 1866
      OR cp BETWEEN 1958 AND 1968
      OR cp BETWEEN 2027 AND 2035
      OR cp BETWEEN 2070 AND 2073
      OR cp BETWEEN 2075 AND 2083
      OR cp BETWEEN 2085 AND 2087
      OR cp BETWEEN 2089 AND 2093
      OR cp BETWEEN 2137 AND 2139
      OR cp BETWEEN 2260 AND 2273
      OR cp BETWEEN 2275 AND 2303
      OR cp BETWEEN 7616 AND 7679
      OR cp BETWEEN 8400 AND 8432
      OR cp BETWEEN 12330 AND 12333
      OR cp BETWEEN 12441 AND 12442
      OR cp BETWEEN 65056 AND 65071;
$$;

CREATE OR REPLACE FUNCTION factrove_strip_marks(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  result text := '';
  index integer;
  character text;
BEGIN
  FOR index IN 1..char_length(coalesce(value, '')) LOOP
    character := substr(value, index, 1);
    IF NOT factrove_is_combining_mark(ascii(character)) THEN
      result := result || character;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION factrove_fit_slug(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(substr(coalesce(value, ''), 1, 48), '-+$', '');
$$;

CREATE OR REPLACE FUNCTION factrove_slug_with_suffix(stem text, suffix text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  head text := regexp_replace(substr(stem, 1, GREATEST(0, 48 - char_length(suffix))), '-+$', '');
BEGIN
  IF head = '' THEN
    RETURN factrove_fit_slug(regexp_replace(suffix, '^-+', ''));
  END IF;
  RETURN head || suffix;
END;
$$;

CREATE OR REPLACE FUNCTION factrove_slug_base(input_name text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  stripped text := lower(factrove_strip_marks(normalize(coalesce(input_name, ''), NFKD)));
  hyphenated text;
BEGIN
  hyphenated := regexp_replace(stripped, '[^a-z0-9]+', '-', 'g');
  hyphenated := regexp_replace(hyphenated, '^-+|-+$', '', 'g');
  RETURN factrove_fit_slug(hyphenated);
END;
$$;

CREATE OR REPLACE FUNCTION factrove_slug_candidates(input_name text, random_suffixes text[]) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  base text := factrove_slug_base(input_name);
  stem text := CASE WHEN base = '' THEN 'org' ELSE base END;
  raw text[] := ARRAY[]::text[];
  candidates text[] := ARRAY[]::text[];
  suffix integer;
  random_suffix text;
  item text;
BEGIN
  IF base <> '' AND base NOT IN ('local', 'admin', 'api', 'app', 'www') THEN
    raw := array_append(raw, base);
  END IF;
  FOR suffix IN 2..8 LOOP
    raw := array_append(raw, factrove_slug_with_suffix(stem, '-' || suffix::text));
  END LOOP;
  IF random_suffixes IS NOT NULL THEN
    FOREACH random_suffix IN ARRAY random_suffixes LOOP
      raw := array_append(raw, factrove_slug_with_suffix('org', '-' || random_suffix));
    END LOOP;
  END IF;
  FOREACH item IN ARRAY raw LOOP
    IF item <> '' AND NOT item = ANY (candidates) THEN
      candidates := array_append(candidates, item);
    END IF;
  END LOOP;
  RETURN candidates;
END;
$$;

CREATE OR REPLACE FUNCTION factrove_backfill_organizations() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  user_row record;
  display_name text;
  suffixes text[];
  candidates text[];
  candidate text;
  created_organization_id text;
  leftover text;
BEGIN
  FOR user_row IN
    SELECT "user".id, "user".name, "user".email
    FROM "user"
    WHERE "user".id <> 'local-user'
      AND NOT EXISTS (
        SELECT 1 FROM member WHERE member."userId" = "user".id
      )
    ORDER BY "user".id
  LOOP
    display_name := factrove_backfill_display_name(user_row.name, user_row.email);
    suffixes := ARRAY[
      substr(md5(user_row.id || 'a' || clock_timestamp()::text || random()::text), 1, 6),
      substr(md5(user_row.id || 'b' || clock_timestamp()::text || random()::text), 1, 6),
      substr(md5(user_row.id || 'c' || clock_timestamp()::text || random()::text), 1, 6),
      substr(md5(user_row.id || 'd' || clock_timestamp()::text || random()::text), 1, 6)
    ];
    candidates := factrove_slug_candidates(display_name, suffixes);
    created_organization_id := NULL;
    FOREACH candidate IN ARRAY candidates LOOP
      BEGIN
        INSERT INTO organization (id, name, slug, "createdAt")
        VALUES (gen_random_uuid()::text, display_name, candidate, CURRENT_TIMESTAMP)
        RETURNING id INTO created_organization_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        created_organization_id := NULL;
      END;
    END LOOP;
    IF created_organization_id IS NULL THEN
      RAISE EXCEPTION 'organization slug candidates exhausted for user %', user_row.id;
    END IF;
    INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
    VALUES (gen_random_uuid()::text, created_organization_id, user_row.id, 'owner', CURRENT_TIMESTAMP);
  END LOOP;

  UPDATE session
  SET "activeOrganizationId" = only_org.organization_id,
      "updatedAt" = CURRENT_TIMESTAMP
  FROM (
    SELECT "userId" AS user_id, min("organizationId") AS organization_id
    FROM member
    GROUP BY "userId"
    HAVING count(*) = 1
  ) AS only_org
  WHERE session."userId" = only_org.user_id
    AND (
      session."activeOrganizationId" IS NULL
      OR session."activeOrganizationId" = ''
    );

  UPDATE artifact
  SET organization_id = 'local-org'
  WHERE organization_id IS NULL
    AND creator_user_id = 'local-user'
    AND EXISTS (SELECT 1 FROM organization WHERE id = 'local-org');

  UPDATE artifact
  SET organization_id = single.organization_id
  FROM (
    SELECT "userId" AS user_id, min("organizationId") AS organization_id
    FROM member
    GROUP BY "userId"
    HAVING count(*) = 1
  ) AS single
  WHERE artifact.organization_id IS NULL
    AND artifact.creator_user_id = single.user_id
    AND artifact.creator_user_id <> 'local-user';

  SELECT artifact.creator_user_id INTO leftover
  FROM artifact
  WHERE artifact.organization_id IS NULL
  LIMIT 1;
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'artifact.organization_id is null for creator %', leftover;
  END IF;
  RETURN 'ok';
END;
$$;

SELECT factrove_backfill_organizations();

ALTER TABLE "artifact" ALTER COLUMN "organization_id" SET NOT NULL;
