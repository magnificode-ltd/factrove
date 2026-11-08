"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { safeNextPath } from "@/auth/return-path";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordRoute />
    </Suspense>
  );
}

function ResetPasswordRoute() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const errored = params.get("error") === "INVALID_TOKEN";
  const token = errored ? null : params.get("token");
  return <ResetPasswordForm token={token} next={next} />;
}
