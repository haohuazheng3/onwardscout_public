import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE } from "@/lib/site";
import "./globals.css";

/*
 * Root layout: a pass-through. `[locale]/layout.tsx` renders <html lang> for every page;
 * the root not-found and global-error render their own documents. The stylesheet is
 * imported here so those two get it as well, and metadataBase is set here so the file-based
 * /opengraph-image resolves to an absolute URL on those documents too.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
