"use client";

import { useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ArtifactDto, ContextEnvelope } from "@factrove/contracts";
import { ArtifactActions, type ArtifactActionHandle } from "@/components/artifact-actions";
import { copyToClipboard } from "@/components/copy-button";
import { DocsLink } from "@/components/docs-link";
import { OrgShareControl, type OrgShareHandle } from "@/components/org-share-control";
import { SourceCodeLink } from "@/components/source-code-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const menuItemClass =
  "flex h-8 min-w-0 cursor-pointer items-center rounded-md px-2.5 text-sm text-ink outline-none data-highlighted:bg-lilac";

export function ViewerMenu({
  artifactId,
  name = null,
  owner = false,
  organization = null,
  showOrgShare = false,
  onRenamed,
  onDeleted,
  onShared,
  onAudienceChange
}: {
  artifactId?: string;
  name?: string | null;
  owner?: boolean;
  organization?: ContextEnvelope["organization"] | null;
  showOrgShare?: boolean;
  onRenamed?: (artifact: ArtifactDto) => void;
  onDeleted?: () => void;
  onShared?: (artifact: ArtifactDto) => void;
  onAudienceChange?: (organization: ContextEnvelope["organization"]) => void;
}) {
  const menuRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<ArtifactActionHandle>(null);
  const orgRef = useRef<OrgShareHandle>(null);
  const canManage = owner && Boolean(artifactId) && onRenamed !== undefined && onDeleted !== undefined;
  const canShareOrg = showOrgShare && organization !== null && Boolean(artifactId) && onShared !== undefined;

  function openFromMenu(run: (trigger: HTMLButtonElement | null) => void) {
    const trigger = menuRef.current;
    window.setTimeout(() => run(trigger), 0);
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            ref={menuRef}
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label="More actions"
            data-testid="viewer-more-actions"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-white p-1 shadow-[0_12px_32px_-16px_color-mix(in_srgb,var(--ink)_35%,transparent)]"
          >
            {canManage ? (
              <DropdownMenu.Item
                className={menuItemClass}
                onSelect={() => openFromMenu((trigger) => actionsRef.current?.openRename(trigger))}
              >
                Rename
              </DropdownMenu.Item>
            ) : null}
            {artifactId ? (
              <DropdownMenu.Item
                className={menuItemClass}
                onSelect={() => {
                  void copyToClipboard(artifactId, "Artifact ID copied");
                }}
              >
                Copy ID
              </DropdownMenu.Item>
            ) : null}
            {canShareOrg && organization ? (
              <DropdownMenu.Item
                className={menuItemClass}
                onSelect={() => openFromMenu((trigger) => orgRef.current?.open(trigger))}
              >
                <span className="min-w-0 truncate">
                  Share with <bdi>{organization.name}</bdi>
                </span>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item asChild className={menuItemClass}>
              <DocsLink />
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild className={menuItemClass}>
              <SourceCodeLink />
            </DropdownMenu.Item>
            {canManage ? (
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
      {canManage && artifactId ? (
        <ArtifactActions
          ref={actionsRef}
          artifactId={artifactId}
          name={name}
          buttons={false}
          onRenamed={onRenamed}
          onDeleted={onDeleted}
        />
      ) : null}
      {canShareOrg && organization && artifactId ? (
        <OrgShareControl
          ref={orgRef}
          artifactId={artifactId}
          organizationId={organization.id}
          organizationName={organization.name}
          button={false}
          onShared={onShared}
          onAudienceChange={onAudienceChange}
        />
      ) : null}
    </>
  );
}
