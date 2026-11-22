import type { AccessType } from "@factrove/contracts";

const uploadedAtFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC"
});

export function artifactLabel(artifact: { id: string; name?: string | null }): string {
  const name = artifact.name?.trim();
  if (name) return name;
  return artifact.id;
}

export function accessLabel(accessType: AccessType): string {
  return accessType === "private" ? "Private" : "Organization shared";
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatUploadedAt(iso: string): string {
  return `${uploadedAtFormat.format(new Date(iso))} UTC`;
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const delta = now - new Date(iso).getTime();
  if (!Number.isFinite(delta)) return formatUploadedAt(iso);
  const seconds = Math.max(0, Math.round(delta / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`;
  return formatUploadedAt(iso);
}

export function isEmbeddableContentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
