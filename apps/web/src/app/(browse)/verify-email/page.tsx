"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { VerifyEmailScreen } from "@/components/verify-email-screen";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailRoute />
    </Suspense>
  );
}

function VerifyEmailRoute() {
  return <VerifyEmailScreen token={useSearchParams().get("token")} />;
}
