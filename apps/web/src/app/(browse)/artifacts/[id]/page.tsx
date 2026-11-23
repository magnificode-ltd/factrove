import { redirect } from "next/navigation";
import { createRequestClient } from "@/api/server-client";
import { pendingInvitationPath } from "@/auth/pending-invitation";
import { loadArtifact } from "@/viewer/load-artifact";
import { ViewerScreen } from "@/viewer/viewer-screen";

export const dynamic = "force-dynamic";

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await loadArtifact(await createRequestClient(), id);
  if (state.status === "setup-required") {
    redirect((await pendingInvitationPath()) ?? "/onboarding");
  }
  return <ViewerScreen state={state} />;
}
