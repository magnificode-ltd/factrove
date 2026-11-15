import type { ReactNode } from "react";
import { VerifyEmailNotice } from "@/components/verify-email-notice";

export default function BrowseLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <VerifyEmailNotice />
      {children}
    </>
  );
}
