"use client";

import { useState } from "react";

export const CONTENT_LOAD_FAILURE = "The artifact content could not be loaded. Refresh to try again.";

export function ArtifactFrame({ contentUrl }: { contentUrl: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p role="alert" className="banner error">
        {CONTENT_LOAD_FAILURE}
      </p>
    );
  }

  return (
    <iframe
      className="stage-frame"
      title="Uploaded HTML"
      src={contentUrl}
      // allow-scripts only: the document cannot read the Next.js parent.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
