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

export type SectionId = 'daily' | 'feed' | 'people' | 'meet';

/**
 * One section of the site. The same list drives the tab bar (SiteNav) and the
 * "店里有什么" shelf list (homepage sidebar, about page), so a new section is
 * added here and nowhere else.
 */
export interface Shelf {
  id: SectionId;
  /** Where the shelf list links to. */
  href: string;
  name: string;
  desc: string;
  /** The tab bar's label and link (the daily tab opens the homepage). */
  tab: string;
  tabHref: string;
  /** Small "beta" mark after the tab label. */
  beta?: boolean;
  /** Shown only when the community (login) service is enabled. */
  needsCommunity?: boolean;
  /** Paths whose tab this is: exact for '/', otherwise the path and everything under it. */
  paths: string[];
}

/** Sections of the site, in the order they appear in navigation and on the homepage. */
export const SHELVES: Shelf[] = [
  {
    id: 'daily', href: '/daily', name: `${DAILY_NAME} 每日 AI 精选`, desc: '每天用算法从全网筛出最值得看的 AI 动态',
    tab: 'AI 日报', tabHref: '/', paths: ['/', '/daily', '/article', '/history', '/projects'],
  },
  {
    id: 'feed', href: '/feed', name: '动态', desc: 'AI 圈博主最近 24 小时在 X 上说了什么，中文翻译、可看原文',
    tab: '动态', tabHref: '/feed', paths: ['/feed'],
  },
  {
    id: 'people', href: '/people', name: '人物', desc: '以人为镜：他们做成了什么，在风口浪尖上怎么选择',
    tab: '人物', tabHref: '/people', paths: ['/people'],
  },
  {
    id: 'meet', href: '/meet', name: '相亲贴', desc: '给认真生活的开发者，认识一个对的人',
    tab: '相亲贴', tabHref: '/meet', needsCommunity: true, paths: ['/meet'],
  },
];

/** The sections a visitor can see: community-only ones need the community service. */
export function visibleShelves(communityEnabled: boolean): Shelf[] {
  return SHELVES.filter((shelf) => !shelf.needsCommunity || communityEnabled);
}

const underPath = (pathname: string, base: string) =>
  base === '/' ? pathname === '/' : pathname === base || pathname.startsWith(`${base}/`);

/** The section a path belongs to, for the active tab; null for about, legal and other site pages. */
export function sectionForPath(pathname: string): SectionId | null {
  return SHELVES.find((shelf) => shelf.paths.some((base) => underPath(pathname, base)))?.id ?? null;
}
