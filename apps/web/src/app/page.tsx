import { createWebClient } from "@/api/client";
import { libraryViewFromParam, loadLibrary } from "@/library/load-library";
import { LibraryScreen } from "@/library/library-screen";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const params = await searchParams;
  const state = await loadLibrary(createWebClient(), libraryViewFromParam(params.view));
  return <LibraryScreen state={state} />;
}
