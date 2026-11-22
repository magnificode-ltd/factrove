"use client";

import { useEffect, useState } from "react";
import type { AccessType, ArtifactDto, ContextEnvelope } from "@factrove/contracts";
import { ArtifactActions } from "@/components/artifact-actions";
import { CopyButton } from "@/components/copy-button";
import { OrgShareControl } from "@/components/org-share-control";
import { ShareControl } from "@/components/share-control";
import { Badge } from "@/components/ui/badge";
import { accessLabel, artifactLabel, formatBytes, formatRelativeTime, formatUploadedAt } from "@/format";

export function ArtifactCard({
  artifact,
  now,
  canShare = false,
  organization = null
}: {
  artifact: ArtifactDto;
  now: number;
  canShare?: boolean;
  organization?: ContextEnvelope["organization"];
}) {
  const [accessType, setAccessType] = useState<AccessType>(artifact.accessType);
  const [name, setName] = useState(artifact.name);
  const [audience, setAudience] = useState(organization);
  useEffect(() => {
    setAudience(organization);
  }, [organization]);
  const uploaded = formatUploadedAt(artifact.uploadedAt);
  const label = artifactLabel({ ...artifact, name });

  return (
    <li className="ft-card relative">
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
        <a
          className="min-w-40 flex-1 truncate text-base font-semibold text-ink no-underline after:absolute after:inset-0 after:rounded-[14px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d"
          href={`/artifacts/${encodeURIComponent(artifact.id)}`}
          title={label}
        >
          {label}
        </a>
        <div className="pointer-events-none relative z-10 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground sm:justify-end">
          <code className="font-mono text-[13px] tracking-tight text-ink">{artifact.id}</code>
          {canShare ? (
            <span className="pointer-events-auto relative z-10">
              <ShareControl
                artifactId={artifact.id}
                initial={{ shared: artifact.shared, shareUrl: null, passwordProtected: artifact.passwordProtected }}
                compact
              />
            </span>
          ) : null}
          {canShare ? (
            <span className="pointer-events-auto relative z-10 flex flex-wrap items-center gap-2">
              <ArtifactActions
                artifactId={artifact.id}
                name={name}
                compact
                returnTo="/"
                onRenamed={(next) => setName(next.name)}
                onDeleted={() => {
                  window.location.reload();
                }}
              />
            </span>
          ) : null}
          {canShare && accessType === "private" && audience ? (
            <span className="pointer-events-auto relative z-10 max-w-full min-w-0">
              <OrgShareControl
                artifactId={artifact.id}
                organizationId={audience.id}
                organizationName={audience.name}
                compact
                onShared={(next) => setAccessType(next.accessType)}
                onAudienceChange={setAudience}
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
          <Badge
            id={`artifact-access-${artifact.id}`}
            tabIndex={-1}
            data-testid="artifact-access"
            data-access={accessType}
            aria-live="polite"
            variant={accessType === "private" ? "secondary" : "default"}
            className="h-6 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d"
          >
            {accessLabel(accessType)}
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
