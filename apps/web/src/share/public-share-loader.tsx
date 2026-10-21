"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicBrowserClient } from "@/api/client";
import { ViewerBar } from "@/components/chrome";
import { loadPublicArtifact, unlockPublicArtifact, type PublicShareModel } from "@/share/load-public-artifact";
import type { UnlockFeedback } from "@/share/locked-share";
import { PublicShareScreen } from "@/share/public-share-screen";
import { clearShareGrant, readShareGrant, saveShareGrant } from "@/share/share-grant-store";

const UNLOCK_MOTION_MS = 720;

export function PublicShareLoader({
  id,
  token,
  fetchImpl
}: {
  id: string;
  token: string;
  fetchImpl?: typeof fetch;
}) {
  const [state, setState] = useState<PublicShareModel | null>(null);
  const [opening, setOpening] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const active = useRef(true);
  const client = useMemo(() => createPublicBrowserClient(fetchImpl), [fetchImpl]);

  useEffect(() => {
    active.current = true;
    const grant = readShareGrant(id, token);
    void loadPublicArtifact(client, id, token, grant).then((next) => {
      if (!active.current) {
        return;
      }
      if (next.status === "locked") {
        clearShareGrant(id);
      }
      setState(next);
    });
    return () => {
      active.current = false;
    };
  }, [client, id, token]);

  const onUnlock = useCallback(
    async (password: string): Promise<UnlockFeedback> => {
      const result = await unlockPublicArtifact(client, id, token, password);
      if (!active.current) {
        return null;
      }
      if (result.status === "incorrect" || result.status === "throttled") {
        return result;
      }
      if (result.status !== "unlocked") {
        setState(result);
        return null;
      }
      if (result.grant) {
        saveShareGrant(id, token, result.grant);
      }
      const next = await loadPublicArtifact(client, id, token, result.grant?.token ?? null);
      if (!active.current) {
        return null;
      }
      if (next.status !== "ready") {
        clearShareGrant(id);
        setState(next);
        return null;
      }
      setOpening(true);
      await wait(prefersReducedMotion() ? 0 : UNLOCK_MOTION_MS);
      if (active.current) {
        setOpening(false);
        setUnlocked(true);
        setState(next);
      }
      return null;
    },
    [client, id, token]
  );

  if (!state) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-background">
        <ViewerBar title="Shared artifact" showLibraryLink={false} />
        <main className="flex min-h-0 flex-1 items-center bg-white px-6 sm:px-10">
          <p role="status" className="text-lg">
            Opening shared artifact…
          </p>
        </main>
      </div>
    );
  }

  return <PublicShareScreen state={state} opening={opening} unlocked={unlocked} onUnlock={onUnlock} />;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
