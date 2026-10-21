import { createRoot } from "react-dom/client";
import { ShareControl } from "@/components/share-control";
import "@/app/globals.css";

const id = "883769fe-8bfc-4965-b76b-682bd7cf86cb";
const shareUrl = `http://localhost:3000/share/${id}/nEcalaC6IC5188JbNrVZf12Xs3g-L2vBkYgrYcKBdYPCc`;
const params = new URLSearchParams(window.location.search);
const passwordProtected = params.get("password") !== "off";

document.documentElement.style.setProperty("--font-inter", "Inter, ui-sans-serif, system-ui, sans-serif");
document.documentElement.style.setProperty("--font-jetbrains", "'JetBrains Mono', ui-monospace, monospace");

const share = {
  shared: true,
  shareUrl,
  passwordProtected
};

window.fetch = async () =>
  new Response(JSON.stringify({ share }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

const root = document.getElementById("root");
if (!root) {
  throw new Error("root is required");
}

createRoot(root).render(
  <div className="min-h-dvh bg-cloud p-6">
    <div className="flex justify-end">
      <ShareControl artifactId={id} initial={share} />
    </div>
  </div>
);
