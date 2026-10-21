import "server-only";
import type { ReactNode } from "react";
import { compileMDX } from "next-mdx-remote/rsc";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { Answer, Callout, DataPoint, MdxLink } from "@/components/blog/MdxBlocks";
import { rehypeAutolink, type AutolinkTerm } from "./autolink";

/*
 * Compiles one article body to React on the server (at build, and when an ISR page is
 * regenerated): GitHub-flavoured markdown (tables, task lists, autolinks), heading ids for the
 * table of contents (the same ids extractHeadings() computes), and automatic internal links.
 * JavaScript expressions in MDX are blocked (next-mdx-remote's default), so component
 * attributes are plain strings.
 */

export const MDX_COMPONENTS = {
  Callout,
  Answer,
  DataPoint,
  a: MdxLink,
};

export async function renderMdx(source: string, opts: { autolink?: AutolinkTerm[]; self?: string } = {}): Promise<ReactNode> {
  const { content } = await compileMDX({
    source,
    components: MDX_COMPONENTS,
    options: {
      parseFrontmatter: false,
      mdxOptions: {
        format: "mdx",
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeSlug, [rehypeAutolink, { terms: opts.autolink ?? [], self: opts.self }]],
      },
    },
  });
  return content;
}
