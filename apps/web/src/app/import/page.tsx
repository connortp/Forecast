import type { Metadata } from "next";
import { ImportPreviewClient } from "@/components/ClientOnly";

export const metadata: Metadata = { title: "Import history · Forecast" };

export default function ImportPage() {
  return <ImportPreviewClient />;
}
