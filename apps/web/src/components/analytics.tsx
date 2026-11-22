"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { browserPosthogConfig, browserTrackingDisabled, capturePageview, startAnalytics } from "@/analytics";

export function Analytics() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || browserTrackingDisabled()) {
      return;
    }
    let cancelled = false;
    void startAnalytics(browserPosthogConfig()).then((client) => {
      if (cancelled || !client) {
        return;
      }
      capturePageview(client, pathname, window.location.origin);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  return null;
}
