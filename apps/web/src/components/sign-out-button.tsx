"use client";

import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      variant="outline"
      className="h-10"
      type="button"
      onClick={() => {
        void authClient.signOut().then(() => {
          window.location.assign("/");
        });
      }}
    >
      Sign out
    </Button>
  );
}
