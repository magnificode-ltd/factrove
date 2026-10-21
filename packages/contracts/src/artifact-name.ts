import * as z from "zod";

export const ARTIFACT_NAME_MAX_LENGTH = 120;
export const ARTIFACT_NAME_MESSAGE = "name must be one line of 1 to 120 characters.";

// C0, DEL, C1, and the Unicode line separators. Checked before trim so a trailing break is rejected.
const ARTIFACT_NAME_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;

export function artifactNameHasForbiddenCharacter(value: string): boolean {
  return ARTIFACT_NAME_FORBIDDEN.test(value.normalize("NFC"));
}

export function artifactNameCodePointLength(value: string): number {
  return [...value].length;
}

// NFC first. Forbidden characters are rejected before trimming. Then 1 to 120 code points.
// Null means the value cannot be stored.
export function normalizeArtifactName(value: string): string | null {
  const normalized = value.normalize("NFC");
  if (artifactNameHasForbiddenCharacter(normalized)) {
    return null;
  }
  const trimmed = normalized.trim();
  const length = artifactNameCodePointLength(trimmed);
  if (length === 0 || length > ARTIFACT_NAME_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

type CodePointBoundDef = {
  check: "min_length" | "max_length";
  minimum?: number;
  maximum?: number;
  abort?: boolean;
};

type CodePointBoundInst = {
  _zod: {
    def: CodePointBoundDef;
    onattach: Array<(schema: { _zod: { bag: { minimum?: number; maximum?: number } } }) => void>;
    check: (payload: { value: string; issues: object[] }) => void;
  };
};

// Zod's string min/max count UTF-16 units. A name is 1 to 120 Unicode code points,
// and JSON Schema maxLength uses that same unit. The bag keeps minLength and maxLength.
const CodePointBound = z.core.$constructor(
  "CodePointBound",
  ((inst: CodePointBoundInst, def: CodePointBoundDef) => {
    z.core.$ZodCheck.init(inst, def);
    inst._zod.onattach.push((schema) => {
      if (typeof def.maximum === "number") {
        const current = schema._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
        if (def.maximum < current) {
          schema._zod.bag.maximum = def.maximum;
        }
      }
      if (typeof def.minimum === "number") {
        const current = schema._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
        if (def.minimum > current) {
          schema._zod.bag.minimum = def.minimum;
        }
      }
    });
    inst._zod.check = (payload) => {
      const length = artifactNameCodePointLength(payload.value);
      if (def.maximum !== undefined && length > def.maximum) {
        payload.issues.push({
          code: "too_big",
          origin: "string",
          maximum: def.maximum,
          inclusive: true,
          input: payload.value,
          inst,
          continue: !def.abort,
        });
      }
      if (def.minimum !== undefined && length < def.minimum) {
        payload.issues.push({
          code: "too_small",
          origin: "string",
          minimum: def.minimum,
          inclusive: true,
          input: payload.value,
          inst,
          continue: !def.abort,
        });
      }
    };
  }) as (inst: z.core.$ZodCheck, def: CodePointBoundDef) => void,
);

export function artifactNameValueSchema(): z.ZodString {
  return z.string().check(
    new CodePointBound({ check: "min_length", minimum: 1 }) as z.core.$ZodCheck<string>,
    new CodePointBound({ check: "max_length", maximum: ARTIFACT_NAME_MAX_LENGTH }) as z.core.$ZodCheck<string>,
  );
}

// Basename with a trailing .html or .htm removed. An unusable stem is null.
export function artifactNameFromFilename(filename: string): string | null {
  const normalized = filename.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const base = slash === -1 ? normalized : normalized.slice(slash + 1);
  return normalizeArtifactName(base.replace(/\.(html|htm)$/i, ""));
}
