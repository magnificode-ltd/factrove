"use client";

import { useEffect, useState, type ComponentType } from "react";

export function ToastHost() {
  const [Toaster, setToaster] = useState<ComponentType | null>(null);

  useEffect(() => {
    let active = true;
    void import("@/components/ui/sonner").then((mod) => {
      if (active) {
        setToaster(() => mod.Toaster);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return Toaster ? <Toaster /> : null;
}
