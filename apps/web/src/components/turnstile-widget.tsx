"use client";

import { useEffect, useRef } from "react";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileRenderOptions = {
  sitekey: string;
  theme: "light";
  size: "flexible";
  appearance: "always";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let pending: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  const ready = window.turnstile;
  if (ready) {
    return Promise.resolve(ready);
  }
  if (pending) {
    return pending;
  }
  const loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      reject(new Error("Turnstile did not load."));
    };
    script.onerror = () => {
      reject(new Error("Turnstile did not load."));
    };
    document.head.append(script);
  });
  pending = loading.catch((error: unknown) => {
    pending = undefined;
    return Promise.reject(error);
  });
  return pending;
}

export function TurnstileWidget({
  siteKey,
  resetKey,
  onToken,
  onError,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
  onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  onTokenRef.current = onToken;
  onErrorRef.current = onError;

  useEffect(() => {
    const element = container.current;
    if (!element) {
      return;
    }
    let cancelled = false;
    const start = (api: TurnstileApi) => {
      if (cancelled) {
        return;
      }
      widgetId.current = api.render(element, {
        sitekey: siteKey,
        theme: "light",
        size: "flexible",
        appearance: "always",
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => {
          onTokenRef.current(null);
          onErrorRef.current();
        },
      });
    };
    if (window.turnstile) {
      start(window.turnstile);
    } else {
      void loadTurnstile().then(start).catch(() => {
        if (!cancelled) {
          onErrorRef.current();
        }
      });
    }
    return () => {
      cancelled = true;
      const id = widgetId.current;
      widgetId.current = null;
      if (id) {
        window.turnstile?.remove(id);
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey === 0) {
      return;
    }
    const id = widgetId.current;
    if (id) {
      window.turnstile?.reset(id);
    }
    onTokenRef.current(null);
  }, [resetKey]);

  return <div ref={container} className="min-h-16" data-turnstile="" />;
}
