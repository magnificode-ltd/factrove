"use client";

import { createFactroveClient } from "@factrove/api-client";

const apiClient = createFactroveClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
});

export default function HomePage() {
  // Keep the scaffold's browser bundle wired to the shared client without making a request.
  void apiClient;
  return <main><h1>Factrove</h1><p>The local artifact library scaffold is ready.</p></main>;
}
