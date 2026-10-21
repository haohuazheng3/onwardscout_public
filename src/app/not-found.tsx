import type { Metadata } from "next";
// No locale context exists outside [locale], so the locale-aware Link cannot be used here.
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { THEME_SCRIPT } from "@/components/ThemeToggle";

/*
 * 404 for paths outside the locale tree (e.g. "/something.txt" that is not a file). The root
 * layout is a pass-through, so this renders its own document. No i18n context exists here:
 * the copy is bilingual and links are plain anchors.
 */

export const metadata: Metadata = {
  title: "Page not found · Onward Scout",
  robots: { index: false, follow: false },
};

export default function RootNotFound() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div className="void-bg" aria-hidden="true" />
        <main id="main" className="safe-x grid min-h-screen-d place-items-center py-10">
          <div className="pane w-full max-w-xl px-6 py-12 text-center sm:px-12 sm:py-14">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-pane-2 shadow-[inset_0_0_0_1px_var(--line)]">
              <LogoMark size={36} />
            </div>
            <p className="eyebrow eyebrow-dot mt-6">404 · Onward Scout</p>
            <h1 className="display mt-4 text-[2.2rem] text-ink sm:text-[2.8rem]">This path doesn’t lead anywhere.</h1>
            <p className="lede mx-auto mt-3 max-w-sm" lang="zh-CN">
              这条路没有通向任何地方。
            </p>
            <div className="mt-8 flex flex-col justify-center gap-2.5 sm:flex-row">
              <Link href="/" className="btn btn-primary">
                Go home
              </Link>
              <Link href="/zh" className="btn btn-ghost" lang="zh-CN">
                回到中文首页
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
