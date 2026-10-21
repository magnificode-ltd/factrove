"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { UnlockResult } from "@/share/load-public-artifact";

export type UnlockFeedback = Extract<UnlockResult, { status: "incorrect" | "throttled" }> | null;

export function LockedShare({
  expired,
  opening,
  onUnlock
}: {
  expired: boolean;
  opening: boolean;
  onUnlock: (password: string) => Promise<UnlockFeedback>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<UnlockFeedback | { status: "empty"; message: string }>(null);
  const [shaking, setShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const noteId = `${inputId}-note`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function shake() {
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || opening) {
      return;
    }
    if (password.length === 0) {
      setFeedback({ status: "empty", message: "Enter the password to unlock this artifact." });
      shake();
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await onUnlock(password);
    setBusy(false);
    if (result) {
      setFeedback(result);
      shake();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  const invalid = feedback !== null && feedback.status !== "throttled";
  return (
    <div className="ft-vault flex h-full items-center justify-center overflow-y-auto px-5 py-10">
      <div
        className="ft-vault-card ft-enter w-full max-w-md rounded-[22px] border border-line bg-white px-6 py-8 sm:px-8"
        data-state={opening ? "opening" : "locked"}
        data-testid="share-lock"
      >
        <LockOrb opening={opening} />
        <p className="mt-6 text-center font-mono text-xs font-medium tracking-[0.16em] text-peri-d uppercase">
          Password protected
        </p>
        <h2 className="ft-title mt-2 text-center text-[1.875rem]">
          {opening ? "Unlocked" : "This artifact is locked"}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-center text-muted-foreground">
          Enter the password the owner gave you. The artifact stays hidden until it checks out.
        </p>
        {expired ? (
          <p role="status" className="mt-5 rounded-[12px] bg-lilac px-4 py-3 text-sm">
            Your access expired or the password changed. Enter it again to keep reading.
          </p>
        ) : null}
        <form
          className={shaking ? "ft-shake mt-6 grid gap-2" : "mt-6 grid gap-2"}
          data-shaking={shaking ? "true" : undefined}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) {
              setShaking(false);
            }
          }}
          noValidate
          aria-busy={busy || opening}
          onSubmit={(event) => void onSubmit(event)}
        >
          <Label htmlFor={inputId}>Password</Label>
          <PasswordInput
            ref={inputRef}
            id={inputId}
            name="password"
            autoComplete="current-password"
            value={password}
            disabled={opening}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={feedback ? `${errorId} ${noteId}` : noteId}
            onChange={(event) => {
              setPassword(event.target.value);
              if (feedback?.status !== "throttled") {
                setFeedback(null);
              }
            }}
          />
          <p id={errorId} role="alert" className="min-h-5 text-sm font-medium text-destructive">
            {feedback?.message ?? ""}
          </p>
          <Button type="submit" className="ft-unlock-button h-12 w-full text-base" disabled={busy || opening}>
            <LockKeyhole aria-hidden="true" />
            {opening ? "Opening…" : busy ? "Checking…" : "Unlock"}
          </Button>
        </form>
        <p id={noteId} className="mt-5 text-center font-mono text-xs text-muted-foreground">
          Access lasts 15 minutes in this tab.
        </p>
      </div>
    </div>
  );
}

function LockOrb({ opening }: { opening: boolean }) {
  return (
    <div className="ft-orb mx-auto" data-open={opening ? "true" : "false"} aria-hidden="true">
      <svg viewBox="0 0 64 64" className="ft-orb-lock" fill="none">
        <path
          className="ft-shackle"
          d="M22 29v-7a10 10 0 0 1 20 0v7"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <rect x="15" y="28" width="34" height="25" rx="7" fill="currentColor" />
        <circle cx="32" cy="38.5" r="3.4" className="ft-keyhole" />
        <rect x="30.4" y="40" width="3.2" height="7" rx="1.6" className="ft-keyhole" />
      </svg>
    </div>
  );
}
