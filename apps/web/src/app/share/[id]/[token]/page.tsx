import type { Metadata } from "next";
import { createWebClient } from "@/api/client";
import { loadPublicArtifact } from "@/share/load-public-artifact";
import { PublicShareScreen } from "@/share/public-share-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Shared artifact"
};

export default async function PublicSharePage({ params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  const state = await loadPublicArtifact(createWebClient(), id, token);
  return <PublicShareScreen state={state} />;
}
