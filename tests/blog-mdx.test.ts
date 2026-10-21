import { createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMdx } from "@/lib/mdx";

// next-intl's navigation needs the Next runtime; a plain anchor stands in for the locale-aware Link.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; locale?: string; children?: unknown }) => {
    delete (rest as { locale?: string }).locale;
    return createElement("a", { href, ...rest }, children as never);
  },
}));

/** End-to-end MDX: GFM, heading ids, the three article components and automatic internal links. */
describe("renderMdx", () => {
  it("renders headings with ids, components, tables and autolinks without nesting anchors", async () => {
    const source = [
      "## Why apply for fellowships?",
      "",
      "<Answer>",
      "Fellowships fund people, not projects.",
      "</Answer>",
      "",
      "Most fellowships ask for references. See [the guides](/guides) or [the official page](https://example.org/x).",
      "",
      '<DataPoint value="11,000" source="https://example.org/report" label="Example">fellowships a year</DataPoint>',
      "",
      '<Callout tone="warn" title="Check the rules">Eligibility windows are strict.</Callout>',
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
    ].join("\n");
    const html = renderToStaticMarkup(
      (await renderMdx(source, { autolink: [{ phrase: "fellowships", href: "/opportunities/fellowships" }], self: "/blog/x/y" })) as ReactElement,
    );
    expect(html).toContain('<h2 id="why-apply-for-fellowships">');
    expect(html).toContain("In short");
    expect(html).toContain("<table>");
    expect(html).toContain('href="https://example.org/report"');
    expect(html).toContain("[Example]");
    expect(html).toContain("Check the rules");
    // Internal link stays on site, external opens a new tab.
    expect(html).toMatch(/<a[^>]*href="\/guides"/);
    expect(html).toMatch(/<a[^>]*href="https:\/\/example.org\/x"[^>]*target="_blank"/);
    // Exactly one autolink, not inside the heading.
    const auto = html.match(/href="\/opportunities\/fellowships"/g) ?? [];
    expect(auto).toHaveLength(1);
    expect(html).not.toMatch(/<h2[^>]*>[^<]*<a/);
    expect(html).not.toMatch(/<a[^>]*>[^<]*<a/);
  });

  it("blocks JavaScript expressions in article bodies", async () => {
    const html = renderToStaticMarkup((await renderMdx("Total: {1 + 1}")) as ReactElement);
    expect(html).not.toContain("2");
  });
});
