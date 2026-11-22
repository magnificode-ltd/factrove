import { redirect } from "next/navigation";
import { createRequestClient } from "@/api/server-client";
import { libraryViewFromParam, loadLibrary } from "@/library/load-library";
import { LibraryScreen } from "@/library/library-screen";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const params = await searchParams;
  const state = await loadLibrary(await createRequestClient(), libraryViewFromParam(params.view));
  if (state.status === "setup-required") {
    redirect("/onboarding");
  }
  if (
    (state.status === "ready" || state.status === "empty" || state.status === "no-organization") &&
    state.context.organization === null
  ) {
    redirect("/onboarding");
  }
  return <LibraryScreen state={state} />;
}
