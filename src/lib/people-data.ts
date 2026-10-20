// Build-time access to the people files and the feed posts they are matched
// with. The files are bundled by Vite (import.meta.glob), so the pages get
// them without touching the file system; scripts/export-site-data.ts reads
// the same directory with node:fs.
import { getFeed } from './data';
import type { FeedPost } from './feed.ts';
import { directoryOrder, filesFromGlob, loadPeople, missingFromPeople, postsByHandle, type Person } from './people.ts';

const modules = import.meta.glob('../content/people/*.json', { eager: true, import: 'default' });

let cached: Promise<{ people: Person[]; byHandle: Map<string, FeedPost[]> }> | null = null;

/** Published people (drafts too on the dev server) in directory order, and the feed's posts by handle. */
export function getPeople() {
  cached ??= (async () => {
    const files = filesFromGlob(modules);
    const people = directoryOrder(loadPeople(files, { includeDrafts: import.meta.env.DEV }));
    const byHandle = postsByHandle(await getFeed());
    // Drafts count as known: no reminder for someone whose file is being written.
    const missing = missingFromPeople(loadPeople(files, { includeDrafts: true }), byHandle);
    if (missing.length > 0) {
      const message = `动态里有 ${missing.length} 位博主还没有人物档案（src/content/people/）：${missing.map((h) => `@${h}`).join(' ')}`;
      console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[people] ${message}`);
    }
    return { people, byHandle };
  })();
  return cached;
}
