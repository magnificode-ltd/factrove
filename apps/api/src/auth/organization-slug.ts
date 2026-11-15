const RESERVED_SLUGS = new Set(["local", "admin", "api", "app", "www"]);
const SLUG_MAX_LENGTH = 48;

export function organizationSlugCandidates(name: string, randomSuffix: () => string): string[] {
  const base = slugBase(name);
  const stem = base.length > 0 ? base : "org";
  const candidates: string[] = [];
  if (base.length > 0 && !RESERVED_SLUGS.has(base)) {
    candidates.push(base);
  }
  for (let suffix = 2; suffix <= 8; suffix += 1) {
    candidates.push(withSuffix(stem, `-${suffix}`));
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    candidates.push(withSuffix("org", `-${randomSuffix()}`));
  }
  return [...new Set(candidates)];
}

function slugBase(name: string): string {
  const stripped = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const hyphenated = stripped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return fit(hyphenated);
}

function withSuffix(stem: string, suffix: string): string {
  const room = Math.max(0, SLUG_MAX_LENGTH - suffix.length);
  const head = stem.slice(0, room).replace(/-+$/g, "");
  if (head.length === 0) {
    return fit(suffix.replace(/^-+/, ""));
  }
  return `${head}${suffix}`;
}

function fit(value: string): string {
  return value.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}
