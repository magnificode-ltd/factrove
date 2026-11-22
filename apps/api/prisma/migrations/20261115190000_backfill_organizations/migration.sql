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

-- Code points where JavaScript /^\p{M}$/u matches, so NFKD mark stripping
-- agrees with organizationSlugCandidates. Includes variation selectors.
CREATE OR REPLACE FUNCTION factrove_is_combining_mark(cp integer) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT cp IS NOT NULL AND EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      int4range(768, 880),
      int4range(1155, 1162),
      int4range(1425, 1470),
      int4range(1471, 1472),
      int4range(1473, 1475),
      int4range(1476, 1478),
      int4range(1479, 1480),
      int4range(1552, 1563),
      int4range(1611, 1632),
      int4range(1648, 1649),
      int4range(1750, 1757),
      int4range(1759, 1765),
      int4range(1767, 1769),
      int4range(1770, 1774),
      int4range(1809, 1810),
      int4range(1840, 1867),
      int4range(1958, 1969),
      int4range(2027, 2036),
      int4range(2045, 2046),
      int4range(2070, 2074),
      int4range(2075, 2084),
      int4range(2085, 2088),
      int4range(2089, 2094),
      int4range(2137, 2140),
      int4range(2199, 2208),
      int4range(2250, 2274),
      int4range(2275, 2308),
      int4range(2362, 2365),
      int4range(2366, 2384),
      int4range(2385, 2392),
      int4range(2402, 2404),
      int4range(2433, 2436),
      int4range(2492, 2493),
      int4range(2494, 2501),
      int4range(2503, 2505),
      int4range(2507, 2510),
      int4range(2519, 2520),
      int4range(2530, 2532),
      int4range(2558, 2559),
      int4range(2561, 2564),
      int4range(2620, 2621),
      int4range(2622, 2627),
      int4range(2631, 2633),
      int4range(2635, 2638),
      int4range(2641, 2642),
      int4range(2672, 2674),
      int4range(2677, 2678),
      int4range(2689, 2692),
      int4range(2748, 2749),
      int4range(2750, 2758),
      int4range(2759, 2762),
      int4range(2763, 2766),
      int4range(2786, 2788),
      int4range(2810, 2816),
      int4range(2817, 2820),
      int4range(2876, 2877),
      int4range(2878, 2885),
      int4range(2887, 2889),
      int4range(2891, 2894),
      int4range(2901, 2904),
      int4range(2914, 2916),
      int4range(2946, 2947),
      int4range(3006, 3011),
      int4range(3014, 3017),
      int4range(3018, 3022),
      int4range(3031, 3032),
      int4range(3072, 3077),
      int4range(3132, 3133),
      int4range(3134, 3141),
      int4range(3142, 3145),
      int4range(3146, 3150),
      int4range(3157, 3159),
      int4range(3170, 3172),
      int4range(3201, 3204),
      int4range(3260, 3261),
      int4range(3262, 3269),
      int4range(3270, 3273),
      int4range(3274, 3278),
      int4range(3285, 3287),
      int4range(3298, 3300),
      int4range(3315, 3316),
      int4range(3328, 3332),
      int4range(3387, 3389),
      int4range(3390, 3397),
      int4range(3398, 3401),
      int4range(3402, 3406),
      int4range(3415, 3416),
      int4range(3426, 3428),
      int4range(3457, 3460),
      int4range(3530, 3531),
      int4range(3535, 3541),
      int4range(3542, 3543),
      int4range(3544, 3552),
      int4range(3570, 3572),
      int4range(3633, 3634),
      int4range(3636, 3643),
      int4range(3655, 3663),
      int4range(3761, 3762),
      int4range(3764, 3773),
      int4range(3784, 3791),
      int4range(3864, 3866),
      int4range(3893, 3894),
      int4range(3895, 3896),
      int4range(3897, 3898),
      int4range(3902, 3904),
      int4range(3953, 3973),
      int4range(3974, 3976),
      int4range(3981, 3992),
      int4range(3993, 4029),
      int4range(4038, 4039),
      int4range(4139, 4159),
      int4range(4182, 4186),
      int4range(4190, 4193),
      int4range(4194, 4197),
      int4range(4199, 4206),
      int4range(4209, 4213),
      int4range(4226, 4238),
      int4range(4239, 4240),
      int4range(4250, 4254),
      int4range(4957, 4960),
      int4range(5906, 5910),
      int4range(5938, 5941),
      int4range(5970, 5972),
      int4range(6002, 6004),
      int4range(6068, 6100),
      int4range(6109, 6110),
      int4range(6155, 6158),
      int4range(6159, 6160),
      int4range(6277, 6279),
      int4range(6313, 6314),
      int4range(6432, 6444),
      int4range(6448, 6460),
      int4range(6679, 6684),
      int4range(6741, 6751),
      int4range(6752, 6781),
      int4range(6783, 6784),
      int4range(6832, 6878),
      int4range(6880, 6892),
      int4range(6912, 6917),
      int4range(6964, 6981),
      int4range(7019, 7028),
      int4range(7040, 7043),
      int4range(7073, 7086),
      int4range(7142, 7156),
      int4range(7204, 7224),
      int4range(7376, 7379),
      int4range(7380, 7401),
      int4range(7405, 7406),
      int4range(7412, 7413),
      int4range(7415, 7418),
      int4range(7616, 7680),
      int4range(8400, 8433),
      int4range(11503, 11506),
      int4range(11647, 11648),
      int4range(11744, 11776),
      int4range(12330, 12336),
      int4range(12441, 12443),
      int4range(42607, 42611),
      int4range(42612, 42622),
      int4range(42654, 42656),
      int4range(42736, 42738),
      int4range(43010, 43011),
      int4range(43014, 43015),
      int4range(43019, 43020),
      int4range(43043, 43048),
      int4range(43052, 43053),
      int4range(43136, 43138),
      int4range(43188, 43206),
      int4range(43232, 43250),
      int4range(43263, 43264),
      int4range(43302, 43310),
      int4range(43335, 43348),
      int4range(43392, 43396),
      int4range(43443, 43457),
      int4range(43493, 43494),
      int4range(43561, 43575),
      int4range(43587, 43588),
      int4range(43596, 43598),
      int4range(43643, 43646),
      int4range(43696, 43697),
      int4range(43698, 43701),
      int4range(43703, 43705),
      int4range(43710, 43712),
      int4range(43713, 43714),
      int4range(43755, 43760),
      int4range(43765, 43767),
      int4range(44003, 44011),
      int4range(44012, 44014),
      int4range(64286, 64287),
      int4range(65024, 65040),
      int4range(65056, 65072),
      int4range(66045, 66046),
      int4range(66272, 66273),
      int4range(66422, 66427),
      int4range(68097, 68100),
      int4range(68101, 68103),
      int4range(68108, 68112),
      int4range(68152, 68155),
      int4range(68159, 68160),
      int4range(68325, 68327),
      int4range(68900, 68904),
      int4range(68969, 68974),
      int4range(69291, 69293),
      int4range(69370, 69376),
      int4range(69446, 69457),
      int4range(69506, 69510),
      int4range(69632, 69635),
      int4range(69688, 69703),
      int4range(69744, 69745),
      int4range(69747, 69749),
      int4range(69759, 69763),
      int4range(69808, 69819),
      int4range(69826, 69827),
      int4range(69888, 69891),
      int4range(69927, 69941),
      int4range(69957, 69959),
      int4range(70003, 70004),
      int4range(70016, 70019),
      int4range(70067, 70081),
      int4range(70089, 70093),
      int4range(70094, 70096),
      int4range(70188, 70200),
      int4range(70206, 70207),
      int4range(70209, 70210),
      int4range(70367, 70379),
      int4range(70400, 70404),
      int4range(70459, 70461),
      int4range(70462, 70469),
      int4range(70471, 70473),
      int4range(70475, 70478),
      int4range(70487, 70488),
      int4range(70498, 70500),
      int4range(70502, 70509),
      int4range(70512, 70517),
      int4range(70584, 70593),
      int4range(70594, 70595),
      int4range(70597, 70598),
      int4range(70599, 70603),
      int4range(70604, 70609),
      int4range(70610, 70611),
      int4range(70625, 70627),
      int4range(70709, 70727),
      int4range(70750, 70751),
      int4range(70832, 70852),
      int4range(71087, 71094),
      int4range(71096, 71105),
      int4range(71132, 71134),
      int4range(71216, 71233),
      int4range(71339, 71352),
      int4range(71453, 71468),
      int4range(71724, 71739),
      int4range(71984, 71990),
      int4range(71991, 71993),
      int4range(71995, 71999),
      int4range(72000, 72001),
      int4range(72002, 72004),
      int4range(72145, 72152),
      int4range(72154, 72161),
      int4range(72164, 72165),
      int4range(72193, 72203),
      int4range(72243, 72250),
      int4range(72251, 72255),
      int4range(72263, 72264),
      int4range(72273, 72284),
      int4range(72330, 72346),
      int4range(72544, 72552),
      int4range(72751, 72759),
      int4range(72760, 72768),
      int4range(72850, 72872),
      int4range(72873, 72887),
      int4range(73009, 73015),
      int4range(73018, 73019),
      int4range(73020, 73022),
      int4range(73023, 73030),
      int4range(73031, 73032),
      int4range(73098, 73103),
      int4range(73104, 73106),
      int4range(73107, 73112),
      int4range(73459, 73463),
      int4range(73472, 73474),
      int4range(73475, 73476),
      int4range(73524, 73531),
      int4range(73534, 73539),
      int4range(73562, 73563),
      int4range(78912, 78913),
      int4range(78919, 78934),
      int4range(90398, 90416),
      int4range(92912, 92917),
      int4range(92976, 92983),
      int4range(94031, 94032),
      int4range(94033, 94088),
      int4range(94095, 94099),
      int4range(94180, 94181),
      int4range(94192, 94194),
      int4range(113821, 113823),
      int4range(118528, 118574),
      int4range(118576, 118599),
      int4range(119141, 119146),
      int4range(119149, 119155),
      int4range(119163, 119171),
      int4range(119173, 119180),
      int4range(119210, 119214),
      int4range(119362, 119365),
      int4range(121344, 121399),
      int4range(121403, 121453),
      int4range(121461, 121462),
      int4range(121476, 121477),
      int4range(121499, 121504),
      int4range(121505, 121520),
      int4range(122880, 122887),
      int4range(122888, 122905),
      int4range(122907, 122914),
      int4range(122915, 122917),
      int4range(122918, 122923),
      int4range(123023, 123024),
      int4range(123184, 123191),
      int4range(123566, 123567),
      int4range(123628, 123632),
      int4range(124140, 124144),
      int4range(124398, 124400),
      int4range(124643, 124644),
      int4range(124646, 124647),
      int4range(124654, 124656),
      int4range(124661, 124662),
      int4range(125136, 125143),
      int4range(125252, 125259),
      int4range(917760, 918000)
    ]::int4range[]) AS span(bounds)
    WHERE bounds @> cp
  );
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
  locked_id text;
  locked_name text;
  locked_email text;
  candidate_ids text[] := ARRAY[]::text[];
  candidate_names text[] := ARRAY[]::text[];
  candidate_emails text[] := ARRAY[]::text[];
  candidate_index integer;
BEGIN
  -- Lock order, held until this transaction commits (including SET NOT NULL below):
  -- 1. artifact ACCESS EXCLUSIVE
  -- 2. candidate user rows FOR UPDATE, in id order
  -- 3. organization inserts
  -- ACCESS EXCLUSIVE is required. SHARE ROW EXCLUSIVE and EXCLUSIVE do not
  -- conflict with ACCESS SHARE or ROW SHARE, so a claim's count or a share's
  -- SELECT FOR UPDATE can start, then wait on its later UPDATE, while
  -- SET NOT NULL waits on that read lock. The artifact lock comes first so an
  -- upload cannot take ROW EXCLUSIVE on artifact and then FOR KEY SHARE on
  -- creator_user_id while this function still holds user locks. Every
  -- candidate user is locked before any organization insert so a create that
  -- already holds a later user's row lock cannot wait on a slug this function
  -- inserted for an earlier user.
  LOCK TABLE artifact IN ACCESS EXCLUSIVE MODE;

  FOR user_row IN
    SELECT "user".id
    FROM "user"
    WHERE "user".id <> 'local-user'
      AND NOT EXISTS (
        SELECT 1 FROM member WHERE member."userId" = "user".id
      )
    ORDER BY "user".id
  LOOP
    SELECT "user".id, "user".name, "user".email
    INTO locked_id, locked_name, locked_email
    FROM "user"
    WHERE "user".id = user_row.id
    FOR UPDATE;
    IF locked_id IS NULL THEN
      CONTINUE;
    END IF;
    candidate_ids := array_append(candidate_ids, locked_id);
    candidate_names := array_append(candidate_names, locked_name);
    candidate_emails := array_append(candidate_emails, locked_email);
  END LOOP;

  FOR candidate_index IN 1 .. coalesce(array_length(candidate_ids, 1), 0) LOOP
    locked_id := candidate_ids[candidate_index];
    -- Same recheck as create-first-organization. The create may have committed
    -- a membership before this row lock was acquired.
    IF EXISTS (SELECT 1 FROM member WHERE member."userId" = locked_id) THEN
      CONTINUE;
    END IF;
    display_name := factrove_backfill_display_name(
      candidate_names[candidate_index],
      candidate_emails[candidate_index]
    );
    suffixes := ARRAY[
      substr(md5(locked_id || 'a' || clock_timestamp()::text || random()::text), 1, 6),
      substr(md5(locked_id || 'b' || clock_timestamp()::text || random()::text), 1, 6),
      substr(md5(locked_id || 'c' || clock_timestamp()::text || random()::text), 1, 6),
      substr(md5(locked_id || 'd' || clock_timestamp()::text || random()::text), 1, 6)
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
      RAISE EXCEPTION 'organization slug candidates exhausted for user %', locked_id;
    END IF;
    INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
    VALUES (gen_random_uuid()::text, created_organization_id, locked_id, 'owner', CURRENT_TIMESTAMP);
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
