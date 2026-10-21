"use client";

import type { PointerEvent } from "react";
import type { ArtifactDto } from "@factrove/contracts";
import { CopyButton } from "@/components/copy-button";
import { ShareControl } from "@/components/share-control";
import { Badge } from "@/components/ui/badge";
import { accessLabel, formatBytes, formatRelativeTime, formatUploadedAt } from "@/format";

export function ArtifactCard({
  artifact,
  now,
  canShare = false
}: {
  artifact: ArtifactDto;
  now: number;
  canShare?: boolean;
}) {
  const uploaded = formatUploadedAt(artifact.uploadedAt);

  function onMove(event: PointerEvent<HTMLLIElement>) {
    if (event.pointerType === "touch") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    event.currentTarget.style.setProperty("--rx", `${(-py * 5).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--ry", `${(px * 6).toFixed(2)}deg`);
  }

  function onLeave(event: PointerEvent<HTMLLIElement>) {
    event.currentTarget.style.setProperty("--rx", "0deg");
    event.currentTarget.style.setProperty("--ry", "0deg");
  }

  return (
    <li className="ft-card relative" onPointerMove={onMove} onPointerLeave={onLeave} onPointerCancel={onLeave}>
      <div className="relative grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <a
          className="min-w-0 truncate text-base font-semibold text-ink no-underline after:absolute after:inset-0 after:rounded-[14px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d"
          href={`/artifacts/${encodeURIComponent(artifact.id)}`}
        >
          {artifact.filename}
        </a>
        <div className="pointer-events-none relative z-10 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground sm:justify-end">
          <code className="font-mono text-[13px] tracking-tight text-ink">{artifact.id}</code>
          {canShare ? (
            <span className="pointer-events-auto relative z-10">
              <ShareControl
                artifactId={artifact.id}
                initial={{ shared: artifact.shared, shareUrl: null }}
                compact
              />
            </span>
          ) : null}
          <span className="pointer-events-auto">
            <CopyButton
              className="h-8"
              label="Copy ID"
              copiedLabel="Copied"
              message="Artifact ID copied"
              value={artifact.id}
            />
          </span>
          <Badge variant={artifact.accessType === "private" ? "secondary" : "default"} className="h-6">
            {accessLabel(artifact.accessType)}
          </Badge>
          <time dateTime={artifact.uploadedAt} title={uploaded}>
            <span className="sr-only">{uploaded}</span>
            <span aria-hidden="true">{formatRelativeTime(artifact.uploadedAt, now)}</span>
          </time>
          <span>{formatBytes(artifact.sizeBytes)}</span>
        </div>
      </div>
    </li>
  );
}
