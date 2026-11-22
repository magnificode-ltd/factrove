"use client";

import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";

export function signOutAndReturnHome() {
  void authClient.signOut().then(() => {
    window.location.assign("/");
  });
}

export function SignOutButton() {
  return (
    <Button variant="outline" className="h-8 bg-white" type="button" onClick={signOutAndReturnHome}>
      Sign out
    </Button>
  );
}
