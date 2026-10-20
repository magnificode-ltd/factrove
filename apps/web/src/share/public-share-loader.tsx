"use client";

import { useEffect, useState } from "react";
import { createPublicBrowserClient } from "@/api/client";
import { ViewerBar } from "@/components/chrome";
import { loadPublicArtifact, type PublicShareModel } from "@/share/load-public-artifact";
import { PublicShareScreen } from "@/share/public-share-screen";

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

  useEffect(() => {
    const client = createPublicBrowserClient(fetchImpl);
    let active = true;
    void loadPublicArtifact(client, id, token).then((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
    };
  }, [fetchImpl, id, token]);

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

  return <PublicShareScreen state={state} />;
}
