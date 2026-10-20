"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { FactroveApiError } from "@factrove/api-client";
import type { ShareState } from "@factrove/contracts";
import { createWebClient } from "@/api/client";
import { authPageHref } from "@/auth/return-path";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ShareControl({
  artifactId,
  initial,
  viewerUrl,
  showCopyLink = false,
  compact = false
}: {
  artifactId: string;
  initial: ShareState;
  viewerUrl?: string;
  showCopyLink?: boolean;
  compact?: boolean;
}) {
  const [share, setShare] = useState(initial);
  const [expanded, setExpanded] = useState(Boolean(initial.shareUrl));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = share.shareUrl ?? viewerUrl ?? "";
  const buttonClass = compact ? "h-8" : "h-10 bg-white";

  async function onShare() {
    if (share.shared && share.shareUrl) {
      setExpanded((open) => !open);
      setError(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const client = createWebClient();
      const envelope = share.shared
        ? await client.getArtifactShare(artifactId)
        : await client.createArtifactShare(artifactId);
      setShare(envelope.share);
      setExpanded(Boolean(envelope.share.shareUrl));
      if (!share.shared && envelope.share.shared) {
        toast.success("Public link created");
      }
    } catch (caught) {
      setError(shareError(caught, artifactId));
    } finally {
      setPending(false);
    }
  }

  async function onRevoke() {
    setPending(true);
    setError(null);
    try {
      const envelope = await createWebClient().revokeArtifactShare(artifactId);
      setShare(envelope.share);
      setExpanded(false);
      toast.success("Public link revoked");
    } catch (caught) {
      setError(shareError(caught, artifactId));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={cn(
        "pointer-events-auto relative z-10 flex flex-wrap items-center gap-2",
        expanded ? "w-full" : "w-auto",
        compact ? "flex-col items-stretch" : ""
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={share.shared ? "default" : "outline"}
          className={cn(buttonClass, share.shared ? "" : "bg-white")}
          aria-expanded={expanded}
          disabled={pending}
          onClick={() => void onShare()}
        >
          <Link2 />
          {pending ? "Sharing…" : share.shared ? "Sharing" : "Share"}
        </Button>
        {showCopyLink && link ? (
          <CopyButton label="Copy link" copiedLabel="Copied" message="Link copied" value={link} />
        ) : null}
      </div>
      {expanded && share.shareUrl ? (
        <div
          role="region"
          aria-label="Public link"
          className="ft-pop ft-key basis-full rounded-[14px] border border-line bg-lilac p-4"
        >
          <p className="text-sm font-medium">Anyone with this link can open the artifact without an account.</p>
          <code className="ft-reveal mt-3 block font-mono text-sm break-all" data-testid="share-url">
            {share.shareUrl}
          </code>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <CopyButton label="Copy link" copiedLabel="Copied" message="Link copied" value={share.shareUrl} />
            <Button
              type="button"
              variant="destructive"
              className="h-10"
              disabled={pending}
              onClick={() => void onRevoke()}
            >
              Stop sharing
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function shareError(error: unknown, artifactId: string): string {
  if (error instanceof FactroveApiError && error.status === 401) {
    window.location.assign(authPageHref("login", `/artifacts/${artifactId}`));
    return "Sign in to continue.";
  }
  if (error instanceof FactroveApiError && error.message.trim().length > 0) {
    return error.message;
  }
  return "The public link could not be updated.";
}
