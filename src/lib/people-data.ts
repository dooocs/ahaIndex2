// Build-time access to the people (the news database's people and
// person_profiles tables) and the feed posts they are matched with. Read
// once per build and shared by every people page.
import { getFeed, getPeopleTables } from './data';
import type { FeedPost } from './feed.ts';
import { directoryOrder, missingFromPeople, peopleFromRows, postsByHandle, type Person } from './people.ts';

let cached: Promise<{ people: Person[]; byHandle: Map<string, FeedPost[]> }> | null = null;

const warn = (message: string) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[people] ${message}`);

/** Published, valid people in directory order, and the feed's posts by handle. */
export function getPeople() {
  cached ??= (async () => {
    const [{ people: rows, profiles }, posts] = await Promise.all([getPeopleTables(), getFeed()]);
    const people = directoryOrder(peopleFromRows(rows, profiles, warn));
    const byHandle = postsByHandle(posts);
    const missing = missingFromPeople(people, byHandle);
    if (missing.length > 0) warn(`动态里有 ${missing.length} 位博主还没有发布的人物档案：${missing.map((h) => `@${h}`).join(' ')}`);
    return { people, byHandle };
  })();
  return cached;
}
