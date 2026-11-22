"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import type { ArtifactDto } from "@factrove/contracts";
import { createWebClient } from "@/api/client";
import { authPageHref } from "@/auth/return-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type DialogMode = "rename" | "delete" | null;

export type ArtifactActionHandle = {
  openRename: (returnFocus?: HTMLButtonElement | null) => void;
  openDelete: (returnFocus?: HTMLButtonElement | null) => void;
};

export function ArtifactActions({
  artifactId,
  name,
  compact = false,
  buttons = true,
  returnTo,
  client,
  onRenamed,
  onDeleted,
  ref
}: {
  artifactId: string;
  name: string | null;
  compact?: boolean;
  buttons?: boolean;
  returnTo?: string;
  client?: FactroveClient;
  onRenamed: (artifact: ArtifactDto) => void;
  onDeleted: () => void;
  ref?: Ref<ArtifactActionHandle>;
}) {
  const [mode, setMode] = useState<DialogMode>(null);
  const [draft, setDraft] = useState(name ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const nameId = useId();
  const dialogId = `artifact-action-${artifactId}`;
  const destination = returnTo ?? `/artifacts/${encodeURIComponent(artifactId)}`;

  useEffect(() => {
    if (mode !== null) {
      return;
    }
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    focusEnabled(target);
  }, [mode]);

  useEffect(() => {
    if (mode === null) {
      return;
    }
    const overlay = overlayRef.current;
    const background: HTMLElement[] = [];
    if (overlay) {
      for (const child of document.body.children) {
        if (child instanceof HTMLElement && child !== overlay && !child.inert) {
          child.inert = true;
          background.push(child);
        }
      }
    }
    if (mode === "rename") {
      nameRef.current?.focus();
      nameRef.current?.select();
    } else {
      cancelRef.current?.focus();
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || pendingRef.current) {
        return;
      }
      event.preventDefault();
      returnFocusRef.current = triggerRef.current;
      setMode(null);
      setError(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      for (const element of background) {
        element.inert = false;
      }
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mode]);

  function close() {
    if (pendingRef.current) {
      return;
    }
    returnFocusRef.current = triggerRef.current;
    setMode(null);
    setError(null);
  }

  function open(next: Exclude<DialogMode, null>, trigger: HTMLButtonElement | null) {
    triggerRef.current = trigger;
    setDraft(name ?? "");
    setError(null);
    setMode(next);
  }

  useImperativeHandle(ref, () => ({
    openRename(returnFocus) {
      open("rename", returnFocus ?? null);
    },
    openDelete(returnFocus) {
      open("delete", returnFocus ?? null);
    }
  }));

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])")
    ].filter((element) => element.getAttribute("aria-disabled") !== "true");
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (pendingRef.current) {
      return;
    }
    const nextName = draft;
    if (nextName.trim().length === 0) {
      setError("Enter a name.");
      nameRef.current?.focus();
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const api = client ?? createWebClient();
    try {
      const envelope = await api.renameArtifact(artifactId, nextName);
      onRenamed(envelope.artifact);
      toast.success("Name updated");
      pendingRef.current = false;
      setPending(false);
      close();
    } catch (caught) {
      setError(actionError(caught, destination));
      pendingRef.current = false;
      setPending(false);
      nameRef.current?.focus();
    }
  }

  async function confirmDelete() {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const api = client ?? createWebClient();
    try {
      await api.deleteArtifact(artifactId);
      toast.success("Artifact deleted");
      pendingRef.current = false;
      setPending(false);
      returnFocusRef.current = null;
      setMode(null);
      setError(null);
      onDeleted();
    } catch (caught) {
      setError(actionError(caught, destination));
      pendingRef.current = false;
      setPending(false);
      if (!focusEnabled(confirmRef.current)) {
        focusEnabled(cancelRef.current);
      }
    }
  }

  const buttonClass = cn("h-auto max-w-full min-w-0 shrink bg-white px-3", compact ? "min-h-8" : "min-h-10");
  const dialog = mode ? (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_32%,transparent)] p-4"
    >
      <div
        ref={dialogRef}
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid={mode === "rename" ? "rename-dialog" : "delete-dialog"}
        className="w-full max-w-md overflow-hidden rounded-[14px] border border-border bg-white p-5 shadow-[0_24px_48px_-24px_color-mix(in_srgb,var(--peri-d)_60%,transparent)]"
        onKeyDown={trapTab}
      >
        {mode === "rename" ? (
          <form onSubmit={(event) => void submitRename(event)}>
            <h2 id={titleId} className="text-lg font-extrabold tracking-tight text-ink">
              Rename artifact
            </h2>
            <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This changes the name in the library and the viewer. The stored HTML stays the same.
            </p>
            <div className="mt-4 grid gap-2">
              <Label htmlFor={nameId}>Name</Label>
              <Input
                ref={nameRef}
                id={nameId}
                value={draft}
                disabled={pending}
                autoComplete="off"
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="mt-3 break-words text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button ref={cancelRef} type="button" variant="outline" className="h-10 bg-white" onClick={close}>
                Cancel
              </Button>
              <Button ref={confirmRef} type="submit" className="h-10" aria-busy={pending} disabled={pending}>
                {pending ? "Saving…" : "Save name"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <h2 id={titleId} className="text-lg font-extrabold tracking-tight text-ink">
              Delete this artifact?
            </h2>
            <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This removes the artifact, its stored HTML, and any public link. This can&apos;t be undone.
            </p>
            {error ? (
              <p role="alert" className="mt-3 break-words text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button ref={cancelRef} type="button" variant="outline" className="h-10 bg-white" onClick={close}>
                Cancel
              </Button>
              <Button
                ref={confirmRef}
                type="button"
                variant="destructive"
                className="h-10"
                aria-busy={pending}
                disabled={pending}
                onClick={() => void confirmDelete()}
              >
                {pending ? "Deleting…" : "Delete artifact"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      {buttons ? (
        <>
          <Button
            type="button"
            variant="outline"
            className={buttonClass}
            aria-haspopup="dialog"
            aria-expanded={mode === "rename"}
            aria-controls={dialogId}
            data-testid="rename-artifact"
            onClick={(event) => open("rename", event.currentTarget)}
          >
            Rename
          </Button>
          <Button
            type="button"
            variant="destructive"
            className={buttonClass}
            aria-haspopup="dialog"
            aria-expanded={mode === "delete"}
            aria-controls={dialogId}
            data-testid="delete-artifact"
            onClick={(event) => open("delete", event.currentTarget)}
          >
            Delete
          </Button>
        </>
      ) : null}
      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}

function focusEnabled(element: HTMLElement | null | undefined): boolean {
  if (!element?.isConnected || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
    return false;
  }
  element.focus();
  return document.activeElement === element;
}

function actionError(error: unknown, returnTo: string): string {
  if (error instanceof FactroveApiError && error.status === 401) {
    window.location.assign(authPageHref("login", returnTo));
    return "Sign in to continue.";
  }
  if (error instanceof FactroveApiError && error.message.trim().length > 0) {
    return error.message;
  }
  return "The artifact could not be updated.";
}
