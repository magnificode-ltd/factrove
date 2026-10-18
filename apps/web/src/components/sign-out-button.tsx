"use client";

import { authClient } from "@/auth/client";

export function SignOutButton() {
  return (
    <button
      className="refresh"
      type="button"
      onClick={() => {
        void authClient.signOut().then(() => {
          window.location.assign("/");
        });
      }}
    >
      Sign out
    </button>
  );
}
