// Build-time access to the people (people_snapshots, synced from the Aliyun
// database) and the feed posts they are matched with. Read once per build and
// shared by every people page.
import { getFeed, getPeopleSyncSeenAt, getPeopleTables } from './data';
import { hoursSince } from './people-snapshots.ts';
import type { FeedPost } from './feed.ts';
import { directoryOrder, missingFromPeople, peopleFromRows, postsByHandle, type Person } from './people.ts';

let cached: Promise<{ people: Person[]; byHandle: Map<string, FeedPost[]> }> | null = null;

const warn = (message: string) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[people] ${message}`);

/** Published, valid people in directory order, and the feed's posts by handle. */
export function getPeople() {
  cached ??= (async () => {
    const [{ people: rows, profiles }, posts, seenAt] = await Promise.all([getPeopleTables(), getFeed(), getPeopleSyncSeenAt()]);
    const age = hoursSince(seenAt);
    // The job checks in every 10 minutes; six hours of silence means it stopped.
    if (age === null || age > 6) warn(`人物快照${age === null ? '还没有同步过' : `已经 ${Math.floor(age)} 小时没有同步`}：检查阿里云的 people-sync 定时任务（select people_sync_overview();）`);
    const people = directoryOrder(peopleFromRows(rows, profiles, warn));
    const byHandle = postsByHandle(posts);
    const missing = missingFromPeople(people, byHandle);
    if (missing.length > 0) warn(`动态里有 ${missing.length} 位博主还没有发布的人物档案：${missing.map((h) => `@${h}`).join(' ')}`);
    return { people, byHandle };
  })();
  return cached;
}
