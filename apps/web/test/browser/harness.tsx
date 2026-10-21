import { createRoot } from "react-dom/client";
import type { ArtifactDto } from "@factrove/contracts";
import { ViewerScreen } from "@/viewer/viewer-screen";

const contentUrl = new URLSearchParams(window.location.search).get("contentUrl");
if (!contentUrl) {
  throw new Error("contentUrl is required");
}

const artifact: ArtifactDto = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  creatorUserId: "local-user",
  organizationId: "local-org",
  accessType: "private",
  filename: "123e4567-e89b-42d3-a456-426614174000.html",
  mimeType: "text/html",
  sizeBytes: 42,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:00:00.000Z",
  uploadedAt: "2026-10-11T10:00:00.000Z",
  viewerUrl: "http://localhost:3000/artifacts/123e4567-e89b-42d3-a456-426614174000",
  contentUrl,
  shared: false,
  passwordProtected: false
};

const root = document.getElementById("root");
if (!root) {
  throw new Error("root is required");
}

createRoot(root).render(<ViewerScreen state={{ status: "ready", artifact }} />);
