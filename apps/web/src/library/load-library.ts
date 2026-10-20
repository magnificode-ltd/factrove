import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import type { ArtifactDto, ArtifactView, ContextEnvelope } from "@factrove/contracts";
import { unavailableMessage } from "@/api/errors";

export type LibraryView = ArtifactView;

export type LibraryModel =
  | { status: "ready"; view: LibraryView; context: ContextEnvelope; items: ArtifactDto[] }
  | { status: "empty"; view: LibraryView; context: ContextEnvelope }
  | { status: "no-organization"; view: "org"; context: ContextEnvelope }
  | { status: "signed-out"; view: LibraryView }
  | { status: "unavailable"; view: LibraryView; message: string };

export function libraryViewFromParam(value: string | string[] | undefined): LibraryView {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "org" ? "org" : "mine";
}

export async function loadLibrary(client: FactroveClient, view: LibraryView): Promise<LibraryModel> {
  try {
    const [context, list] = await Promise.all([client.getContext(), client.listArtifacts({ view })]);
    if (view === "org" && context.organization === null) {
      return { status: "no-organization", view, context };
    }
    if (list.items.length === 0) return { status: "empty", view, context };
    return { status: "ready", view, context, items: list.items };
  } catch (error) {
    if (error instanceof FactroveApiError && error.status === 401) {
      return { status: "signed-out", view };
    }
    return { status: "unavailable", view, message: unavailableMessage(error) };
  }
}
