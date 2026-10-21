import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShareLoader } from "@/share/public-share-loader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
  title: "Shared artifact"
};

const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default async function PublicSharePage({ params }: { params: Promise<{ id: string; token: string }> }) {
  let id: string;
  let token: string;
  try {
    ({ id, token } = await params);
  } catch {
    notFound();
  }
  if (!ARTIFACT_ID.test(id) || !SHARE_TOKEN.test(token)) {
    notFound();
  }
  return <PublicShareLoader id={id} token={token} />;
}
