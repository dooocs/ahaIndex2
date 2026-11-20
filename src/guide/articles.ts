import type { MarkdownInstance } from 'astro';

interface GuideFrontmatter {
  slug: string;
  title: string;
  deck: string;
  topic: string;
  order: number;
}

const articles = Object.values(import.meta.glob<MarkdownInstance<GuideFrontmatter>>('./*.md', { eager: true }))
  .sort((a, b) => a.frontmatter.order - b.frontmatter.order);

export const getGuideArticles = () => articles;

export function estimateMinutes(markdown: string) {
  const text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '');
  const cjk = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words = text.match(/[a-zA-Z][a-zA-Z'-]*/g)?.length ?? 0;
  return Math.max(1, Math.ceil(cjk / 320 + words / 200));
}
