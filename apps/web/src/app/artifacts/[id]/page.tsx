import { createWebClient } from "@/api/client";
import { loadArtifact } from "@/viewer/load-artifact";
import { ViewerScreen } from "@/viewer/viewer-screen";

export const dynamic = "force-dynamic";

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await loadArtifact(createWebClient(), id);
  return <ViewerScreen state={state} />;
}
