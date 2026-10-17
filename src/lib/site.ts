// Site-wide brand copy. Change names here, not in individual pages.
export const SITE_NAME = '蜗牛杂货站';
export const SITE_SLOGAN = '让生活多一点 Amazing';
export const SITE_SLOGAN_EN = 'A little more amazing, every day.';
export const SITE_INTRO = '蜗牛杂货站是一个独立开发者小站，专门做前沿、好玩、有用的小东西。';
export const SITE_DESCRIPTION = `${SITE_INTRO}让生活多一点 Amazing。`;

// The daily AI briefing keeps its original name as a column of the site.
export const DAILY_NAME = 'AmazingIndex';
export const DAILY_TAGLINE = '每日 AI 精选';

export const SITE_URL = 'https://www.amazingindex.com';

/** Title suffix for site-level pages (about, legal, community, subjects). */
export function siteTitle(page: string): string {
  return `${page} | ${SITE_NAME}`;
}

export interface Shelf {
  href: string;
  name: string;
  desc: string;
}

/** Sections of the site, in the order they appear in navigation and on the homepage. */
export const SHELVES: Shelf[] = [
  { href: '/daily', name: `${DAILY_NAME} 每日 AI 精选`, desc: '每天用算法从全网筛出最值得看的 AI 动态' },
  { href: '/feed', name: '动态', desc: 'AI 圈博主最近 24 小时在 X 上说了什么，中英对照' },
  { href: '/subjects', name: '专题', desc: '值得长期关注的公司、人物与技术方向' },
  { href: '/meet', name: '相亲贴', desc: '给认真生活的开发者，认识一个对的人' },
];
