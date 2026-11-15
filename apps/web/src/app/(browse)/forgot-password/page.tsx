"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { safeNextPath } from "@/auth/return-path";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordRoute />
    </Suspense>
  );
}

function ForgotPasswordRoute() {
  const next = safeNextPath(useSearchParams().get("next"));
  return <ForgotPasswordForm next={next} />;
}
