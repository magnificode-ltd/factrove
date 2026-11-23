import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmailRoute } from "@/components/verify-email-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailRoute />
    </Suspense>
  );
}
