// Build-time access to the people (people_snapshots, synced from the Aliyun
// database) and the feed posts they are matched with. Read once per build and
// shared by every people page.
//
// Two kinds of person page: people with a life grid (主线 / 状态, see
// life-grid.ts) get the grid page; everyone else gets the classic page built
// from the old rows (people.ts, with its validation). The directory shows
// only the featured people (people-home.ts).
import { getFeed, getPeopleSnapshots, getPeopleSyncSeenAt } from './data';
import { hoursSince, rowsFromSnapshots } from './people-snapshots.ts';
import { beijingToday, buildLifeGrid, splitPeopleSnapshots, type LifeGrid } from './life-grid.ts';
import { featuredCards, type FeaturedCard } from './people-home.ts';
import type { FeedPost } from './feed.ts';
import { directoryOrder, missingFromPeople, peopleFromRows, postsByHandle, type Person } from './people.ts';

interface PeopleData {
  /** Classic pages: published, valid people in directory order. */
  people: Person[];
  /** Life-grid pages. */
  grids: LifeGrid[];
  /** The directory: featured people with a page, by rank. */
  featured: FeaturedCard[];
  byHandle: Map<string, FeedPost[]>;
}

let cached: Promise<PeopleData> | null = null;

const warn = (message: string) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[people] ${message}`);

export function getPeople() {
  cached ??= (async () => {
    const [snapshots, posts, seenAt] = await Promise.all([getPeopleSnapshots(), getFeed(), getPeopleSyncSeenAt()]);
    const age = hoursSince(seenAt);
    // The job checks in every 10 minutes; six hours of silence means it stopped.
    if (age === null || age > 6) warn(`人物快照${age === null ? '还没有同步过' : `已经 ${Math.floor(age)} 小时没有同步`}：检查阿里云的 people-sync 定时任务（select people_sync_overview();）`);

    const split = splitPeopleSnapshots(snapshots, warn);
    const today = beijingToday();
    const grids = split.grids.map((s) => buildLifeGrid(s, today));
    const { people: rows, profiles } = rowsFromSnapshots(split.legacy);
    const people = directoryOrder(peopleFromRows(rows, profiles, warn));

    const pages = new Set([...people.map((p) => p.slug), ...grids.map((g) => g.slug)]);
    const featured = featuredCards(snapshots, (slug) => pages.has(slug));

    const byHandle = postsByHandle(posts);
    const gridHandles = new Set(grids.flatMap((g) => (g.xHandle ? [g.xHandle.toLowerCase()] : [])));
    const missing = missingFromPeople(people, new Map([...byHandle].filter(([handle]) => !gridHandles.has(handle))));
    if (missing.length > 0) warn(`动态里有 ${missing.length} 位博主还没有发布的人物档案：${missing.map((h) => `@${h}`).join(' ')}`);
    return { people, grids, featured, byHandle };
  })();
  return cached;
}
