import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/** Installable web app: opens straight into the board. Icons come from scripts/gen-icons.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "en",
    dir: "ltr",
    background_color: "#F5F4F0",
    theme_color: "#F5F4F0",
    categories: ["productivity", "business", "education"],
    icons: [
      { src: "/brand/logo-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/logo-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
