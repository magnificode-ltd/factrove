import { Suspense } from "react";
import { turnstileSiteKey } from "@/public-config";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm siteKey={turnstileSiteKey()} />
    </Suspense>
  );
}
