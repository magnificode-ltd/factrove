export const ARTIFACT_NAME_MAX_LENGTH = 120;
export const ARTIFACT_NAME_MESSAGE = "name must be one line of 1 to 120 characters.";

const ARTIFACT_NAME_BREAK = /[\u0000-\u001F\u007F\u2028\u2029]/u;

// NFC, trimmed, one line, 1 to 120 Unicode code points. Null means the value cannot be stored.
export function normalizeArtifactName(value: string): string | null {
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0 || ARTIFACT_NAME_BREAK.test(normalized)) {
    return null;
  }
  if ([...normalized].length > ARTIFACT_NAME_MAX_LENGTH) {
    return null;
  }
  return normalized;
}

// Basename with a trailing .html or .htm removed. An unusable stem is null.
export function artifactNameFromFilename(filename: string): string | null {
  const normalized = filename.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const base = slash === -1 ? normalized : normalized.slice(slash + 1);
  return normalizeArtifactName(base.replace(/\.(html|htm)$/i, ""));
}
