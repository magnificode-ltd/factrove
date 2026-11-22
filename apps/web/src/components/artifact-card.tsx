"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { AccessType, ArtifactDto, ContextEnvelope } from "@factrove/contracts";
import { ArtifactActions, type ArtifactActionHandle } from "@/components/artifact-actions";
import { copyToClipboard, CopyButton } from "@/components/copy-button";
import { OrgShareControl, type OrgShareHandle } from "@/components/org-share-control";
import { ShareControl } from "@/components/share-control";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { accessLabel, artifactLabel, formatBytes, formatRelativeTime, formatUploadedAt } from "@/format";
import { cn } from "@/lib/utils";

const menuItemClass =
  "flex h-8 min-w-0 cursor-pointer items-center rounded-md px-2.5 text-sm text-ink outline-none data-highlighted:bg-lilac";

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
  const showOrgShare = canShare && accessType === "private" && audience !== null;

  return (
    <li className="ft-card ft-artifact relative">
      <div className="ft-artifact-row px-4 py-3.5 sm:px-5">
        <a
          className="ft-artifact-title truncate text-base font-semibold text-ink no-underline after:absolute after:inset-0 after:rounded-[14px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d"
          href={`/artifacts/${encodeURIComponent(artifact.id)}`}
          title={label}
        >
          {label}
        </a>
        <div className="ft-artifact-actions pointer-events-auto relative z-10">
          {canShare ? (
            <ShareControl
              artifactId={artifact.id}
              initial={{ shared: artifact.shared, shareUrl: null, passwordProtected: artifact.passwordProtected }}
              dense
            />
          ) : null}
          <RowMenu
            artifactId={artifact.id}
            name={name}
            canShare={canShare}
            audience={showOrgShare ? audience : null}
            onRenamed={(next) => setName(next.name)}
            onDeleted={() => {
              window.location.reload();
            }}
            onShared={(next) => setAccessType(next.accessType)}
            onAudienceChange={setAudience}
          />
        </div>
        <div className="ft-artifact-meta text-[13px] leading-5 text-muted-foreground">
          <code className="ft-meta-id truncate font-mono text-[13px] text-ink" title={artifact.id} aria-label={artifact.id}>
            {artifact.id.slice(0, 8)}
          </code>
          <span className="ft-meta-copy pointer-events-auto relative z-10">
            <CopyButton
              iconOnly
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
            className="ft-meta-badge h-6 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d"
          >
            {accessLabel(accessType)}
          </Badge>
          <time className="ft-meta-time truncate" dateTime={artifact.uploadedAt} title={uploaded}>
            <span className="sr-only">{uploaded}</span>
            <span aria-hidden="true">{formatRelativeTime(artifact.uploadedAt, now)}</span>
          </time>
          <span className="ft-meta-size whitespace-nowrap">{formatBytes(artifact.sizeBytes)}</span>
        </div>
      </div>
    </li>
  );
}

function RowMenu({
  artifactId,
  name,
  canShare,
  audience,
  onRenamed,
  onDeleted,
  onShared,
  onAudienceChange
}: {
  artifactId: string;
  name: string | null;
  canShare: boolean;
  audience: ContextEnvelope["organization"];
  onRenamed: (artifact: ArtifactDto) => void;
  onDeleted: () => void;
  onShared: (artifact: ArtifactDto) => void;
  onAudienceChange: (organization: ContextEnvelope["organization"]) => void;
}) {
  const menuRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<ArtifactActionHandle>(null);
  const orgRef = useRef<OrgShareHandle>(null);

  function openFromMenu(run: (trigger: HTMLButtonElement | null) => void) {
    const trigger = menuRef.current;
    window.setTimeout(() => run(trigger), 0);
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button ref={menuRef} type="button" variant="outline" size="icon" className="bg-white" aria-label="More actions">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-50 w-64 rounded-xl border border-border bg-white p-1 shadow-[0_12px_32px_-16px_color-mix(in_srgb,var(--ink)_35%,transparent)]"
          >
            {canShare ? (
              <DropdownMenu.Item
                className={menuItemClass}
                onSelect={() => openFromMenu((trigger) => actionsRef.current?.openRename(trigger))}
              >
                Rename
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => {
                void copyToClipboard(artifactId, "Artifact ID copied");
              }}
            >
              Copy ID
            </DropdownMenu.Item>
            {audience ? (
              <DropdownMenu.Item
                className={menuItemClass}
                onSelect={() => openFromMenu((trigger) => orgRef.current?.open(trigger))}
              >
                <span className="min-w-0 truncate">
                  Share with <bdi>{audience.name}</bdi>
                </span>
              </DropdownMenu.Item>
            ) : null}
            {canShare ? (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  className={cn(menuItemClass, "text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive")}
                  onSelect={() => openFromMenu((trigger) => actionsRef.current?.openDelete(trigger))}
                >
                  Delete
                </DropdownMenu.Item>
              </>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {canShare ? (
        <ArtifactActions
          ref={actionsRef}
          artifactId={artifactId}
          name={name}
          buttons={false}
          returnTo="/"
          onRenamed={onRenamed}
          onDeleted={onDeleted}
        />
      ) : null}
      {audience ? (
        <OrgShareControl
          ref={orgRef}
          artifactId={artifactId}
          organizationId={audience.id}
          organizationName={audience.name}
          button={false}
          onShared={onShared}
          onAudienceChange={onAudienceChange}
        />
      ) : null}
    </>
  );
}
