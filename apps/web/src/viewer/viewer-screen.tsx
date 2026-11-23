"use client";

import { useState } from "react";
import type { AccessType, ContextEnvelope } from "@factrove/contracts";
import { ArtifactFrame, CONTENT_LOAD_FAILURE } from "@/components/artifact-frame";
import { ViewerBar } from "@/components/chrome";
import { CopyButton } from "@/components/copy-button";
import { ShareControl } from "@/components/share-control";
import { SignInGate } from "@/components/sign-in-gate";
import { accessLabel, artifactLabel, formatBytes, formatRelativeTime, formatUploadedAt, isEmbeddableContentUrl } from "@/format";
import type { ViewerModel } from "@/viewer/load-artifact";
import { ViewerMenu } from "@/viewer/viewer-menu";

export function ViewerScreen({ state }: { state: ViewerModel }) {
  const initialAccess = state.status === "ready" ? state.artifact.accessType : "private";
  const [accessType, setAccessType] = useState<AccessType>(initialAccess);
  const [name, setName] = useState<string | null>(state.status === "ready" ? state.artifact.name : null);
  const [organization, setOrganization] = useState<ContextEnvelope["organization"]>(
    state.status === "ready" ? state.organization ?? null : null
  );
  if (state.status === "setup-required") {
    return null;
  }
  if (state.status === "signed-out") {
    return <SignInGate message={state.message} returnTo={state.returnTo} />;
  }
  const title =
    state.status === "ready"
      ? artifactLabel({ ...state.artifact, name })
      : state.status === "missing"
        ? "Artifact not found"
        : "Artifact unavailable";
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <ViewerBar
        title={title}
        showAppLinks={false}
        meta={state.status === "ready" ? <ViewerFacts state={state} accessType={accessType} /> : null}
        tools={
          state.status === "ready" ? (
            <ViewerTools
              state={state}
              accessType={accessType}
              organization={organization}
              name={name}
              onShared={(next) => setAccessType(next)}
              onAudienceChange={setOrganization}
              onRenamed={(next) => setName(next.name)}
            />
          ) : (
            <ViewerMenu />
          )
        }
      />
      <main className="min-h-0 flex-1 bg-white">
        {state.status === "ready" ? <ReadyArtifact state={state} /> : <ViewerNotice state={state} />}
      </main>
    </div>
  );
}

function ViewerFacts({
  state,
  accessType
}: {
  state: Extract<ViewerModel, { status: "ready" }>;
  accessType: AccessType;
}) {
  const { artifact } = state;
  const uploaded = formatUploadedAt(artifact.uploadedAt);
  return (
    <div className="flex min-w-0 items-center gap-x-2.5 overflow-hidden text-[13px] leading-5 whitespace-nowrap text-muted-foreground">
      <span
        id={`artifact-access-${artifact.id}`}
        tabIndex={-1}
        data-testid="artifact-access"
        data-access={accessType}
        aria-live="polite"
        className="inline-flex h-5 shrink-0 items-center rounded-md bg-lilac px-1.5 text-xs font-medium text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d"
      >
        {accessLabel(accessType)}
      </span>
      <time className="min-w-0 shrink truncate" dateTime={artifact.uploadedAt} title={uploaded}>
        <span className="sr-only">{uploaded}</span>
        <span aria-hidden="true">{formatRelativeTime(artifact.uploadedAt)}</span>
      </time>
      <span className="shrink-0">{formatBytes(artifact.sizeBytes)}</span>
      <span className="hidden shrink-0 items-center gap-0.5 sm:inline-flex">
        <code className="font-mono text-[12px] tracking-tight text-ink" title={artifact.id} aria-label={artifact.id}>
          {artifact.id.slice(0, 8)}
        </code>
        <CopyButton
          iconOnly
          label="Copy ID"
          copiedLabel="Copied"
          message="Artifact ID copied"
          value={artifact.id}
          className="size-6"
        />
      </span>
    </div>
  );
}

function ViewerTools({
  state,
  accessType,
  organization,
  name,
  onShared,
  onAudienceChange,
  onRenamed
}: {
  state: Extract<ViewerModel, { status: "ready" }>;
  accessType: AccessType;
  organization: ContextEnvelope["organization"];
  name: string | null;
  onShared: (accessType: AccessType) => void;
  onAudienceChange: (organization: ContextEnvelope["organization"]) => void;
  onRenamed: (artifact: { name: string | null }) => void;
}) {
  const { artifact } = state;
  const share = state.share ?? null;
  const showOrgShare = state.owner === true && accessType === "private" && organization !== null;
  return (
    <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
      {share ? (
        <ShareControl
          artifactId={artifact.id}
          initial={share}
          viewerUrl={artifact.viewerUrl}
          showCopyLink
          dense
          primary
        />
      ) : (
        <CopyButton
          label="Copy link"
          copiedLabel="Copied"
          message="Link copied"
          value={artifact.viewerUrl}
          className="h-8 border-border bg-white px-2.5 max-sm:size-8 max-sm:px-0"
          labelClassName="max-sm:sr-only"
        />
      )}
      <ViewerMenu
        artifactId={artifact.id}
        name={name}
        owner={state.owner === true}
        organization={organization}
        showOrgShare={showOrgShare}
        onRenamed={onRenamed}
        onDeleted={() => {
          window.location.assign("/");
        }}
        onShared={(next) => onShared(next.accessType)}
        onAudienceChange={onAudienceChange}
      />
    </div>
  );
}

function ReadyArtifact({ state }: { state: Extract<ViewerModel, { status: "ready" }> }) {
  const { artifact } = state;
  if (!isEmbeddableContentUrl(artifact.contentUrl)) {
    return (
      <div className="flex h-full items-center px-6 sm:px-10">
        <p role="alert" className="max-w-xl text-base text-destructive">
          {CONTENT_LOAD_FAILURE}
        </p>
      </div>
    );
  }
  return <ArtifactFrame key={artifact.contentUrl} contentUrl={artifact.contentUrl} />;
}

function ViewerNotice({ state }: { state: Exclude<ViewerModel, { status: "ready" | "signed-out" | "setup-required" }> }) {
  const calm = state.status === "missing";
  return (
    <div className="flex h-full items-center px-6 sm:px-10">
      <div className="max-w-xl">
        <p role={calm ? "status" : "alert"} className={calm ? "text-lg" : "text-lg text-destructive"}>
          {state.message}
        </p>
      </div>
    </div>
  );
}
