import { Suspense } from "react";
import type { Metadata } from "next";
import { AcceptInviteRoute } from "@/components/accept-invite";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invitation",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteRoute />
    </Suspense>
  );
}
