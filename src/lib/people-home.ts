// 人物首页：蜗牛挑的最多 100 个人，按排位一行五张卡片。
//
// 排位是阿里云 persons.featured_rank（1–100，不重复；set_featured_people()
// 一次性重排），随发布快照同步过来。没有排位的人（多数是动态里的 X 博主）
// 不上首页，但个人页照旧。
import type { SnapshotRow } from './people-snapshots.ts';
import { initialOf } from './people.ts';

export const FEATURED_LIMIT = 100;
export const CARD_TAGS = 3;

export interface FeaturedCard {
  slug: string;
  rank: number;
  /** 卡片上的大名：有中文名用中文名。 */
  name: string;
  /** 小字：另一种写法的名字。 */
  alt: string | null;
  role: string | null;
  initial: string;
  avatar: string | null;
  /** 别人怎么叫他在前，领域在后，最多三个。 */
  tags: string[];
}

/** 有排位、并且确实有页面的人 → 首页卡片，按排位排好，最多 100 张。 */
export function featuredCards(
  snapshots: Pick<SnapshotRow, 'slug' | 'payload'>[],
  hasPage: (slug: string) => boolean,
): FeaturedCard[] {
  return snapshots
    .map((s) => ({ s, p: (s.payload?.person ?? {}) as Record<string, any> }))
    .filter(({ s, p }) => Number.isInteger(p.featured_rank) && p.featured_rank >= 1 && hasPage(p.slug ?? s.slug))
    .sort((a, b) => a.p.featured_rank - b.p.featured_rank)
    .slice(0, FEATURED_LIMIT)
    .map(({ s, p }) => {
      const name = p.name_zh || p.name;
      const labels = (Array.isArray(s.payload.labels) ? s.payload.labels : []).map((l: { text: string }) => l.text);
      const fields = Array.isArray(p.fields) ? p.fields : [];
      return {
        slug: p.slug ?? s.slug,
        rank: p.featured_rank,
        name,
        alt: p.name_zh && p.name_zh !== p.name ? p.name : null,
        role: p.role ?? null,
        initial: initialOf(name),
        avatar: p.avatar_url ?? null,
        tags: [...new Set([...labels, ...fields].filter(Boolean))].slice(0, CARD_TAGS),
      };
    });
}
