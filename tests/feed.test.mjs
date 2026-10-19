import assert from 'node:assert/strict';
import test from 'node:test';
import { beijingTime, getFeedPosts, groupByAuthor, linkLabel, normalizePost, renderPostText, summarize, timeline } from '../src/lib/feed.ts';

const post = (author, updated, extra = {}) => normalizePost({
  id: `${author}-${updated}`, author, display_name: author.toUpperCase(), avatar_url: null,
  published_at: updated, updated_at: updated, url: `https://x.com/${author}/status/1`,
  text_original: 'hi', text_zh: '嗨', media: [], ...extra,
});

test('authors are ordered by their newest post, posts newest first, handles case-insensitive', () => {
  const authors = groupByAuthor([
    post('sama', '2026-10-17T01:00:00Z'),
    post('karpathy', '2026-10-17T03:00:00Z'),
    post('Sama', '2026-10-17T05:00:00Z', { display_name: 'Sam Altman', avatar_url: 'https://www.amazingindex.com/media/x/avatars/s.jpg' }),
  ]);
  assert.deepEqual(authors.map((a) => [a.handle, a.posts.length]), [['Sama', 2], ['karpathy', 1]]);
  assert.equal(authors[0].display_name, 'Sam Altman');
  assert.equal(authors[0].latest_at, '2026-10-17T05:00:00Z');
  assert.deepEqual(authors[0].posts.map((p) => p.updated_at), ['2026-10-17T05:00:00Z', '2026-10-17T01:00:00Z']);
});

test('only media and avatars archived on the site are shown', () => {
  const p = post('sama', '2026-10-17T01:00:00Z', {
    avatar_url: 'https://pbs.twimg.com/a.jpg',
    media: [
      { type: 'photo', url: 'https://www.amazingindex.com/media/x/a.jpg', width: 1200, height: '800' },
      { type: 'photo', url: 'https://pbs.twimg.com/media/b.jpg' },
      { type: 'video' },
      null,
    ],
  });
  assert.equal(p.avatar_url, null);
  assert.deepEqual(p.media, [{ type: 'photo', url: 'https://www.amazingindex.com/media/x/a.jpg', width: 1200, height: 800 }]);
});

test('text is escaped, linked and split into paragraphs', () => {
  const html = renderPostText('Hi <b>&</b> @sama see https://example.com/a?x=1&y=2.\n\nline1\nline2 (https://en.wikipedia.org/wiki/Foo_(bar)) mail a@b.co');
  assert.equal(html,
    '<p>Hi &lt;b&gt;&amp;&lt;/b&gt; <a href="https://x.com/sama" target="_blank" rel="noopener nofollow">@sama</a> see '
    + '<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener nofollow ugc">example.com/a?x=1&amp;y=2</a>.</p>'
    + '<p>line1<br>line2 (<a href="https://en.wikipedia.org/wiki/Foo_(bar)" target="_blank" rel="noopener nofollow ugc">en.wikipedia.org/wiki/Foo_(bar)</a>) mail a@b.co</p>');
});

test('a Chinese full stop right after a link ends it', () => {
  const html = renderPostText('详情：https://openai.com/x，感谢');
  assert.ok(html.includes('<a href="https://openai.com/x" '), html);
  assert.ok(html.includes('>openai.com/x</a>，感谢'), html);
});

test('javascript: and other schemes are never linked', () => {
  assert.equal(renderPostText('javascript:alert(1)'), '<p>javascript:alert(1)</p>');
});

test('long URLs get a short label', () => {
  assert.equal(linkLabel('https://www.anthropic.com/research/designing-efficient-quantum-circuits'), 'anthropic.com/research/designing-ef…');
  assert.equal(linkLabel('https://github.com/nvlabs/aspire/'), 'github.com/nvlabs/aspire');
});

test('times are shown in Beijing time', () => {
  assert.equal(beijingTime('2026-10-16T16:24:26+00:00'), '10-17 00:24');
  assert.equal(beijingTime('2026-10-17T04:24:47Z'), '10-17 12:24');
});

test('the query reads the 24 hours up to the newest post, newest first, and fails loudly', async () => {
  const calls = [];
  // results: one per query, in order (the newest post, then the window).
  const db = (...results) => ({
    from(table) {
      const q = {
        select(cols) { calls.push(['select', cols]); return q; },
        gte(col, value) { calls.push(['gte', col, value]); return q; },
        order(col, opts) { calls.push(['order', col, opts.ascending]); return q; },
        limit(n) { calls.push(['limit', n]); return Promise.resolve(results.shift()); },
      };
      return q;
    },
  });
  const rows = await getFeedPosts(db(
    { data: [{ updated_at: '2026-10-17T09:00:00+00:00' }], error: null },
    { data: [{ id: 'a', author: 'sama', updated_at: '2026-10-17T09:00:00+00:00' }], error: null },
  ));
  assert.equal(rows[0].display_name, 'sama');
  assert.deepEqual(calls.filter((c) => c[0] === 'gte'), [['gte', 'updated_at', '2026-10-16T09:00:00.000Z']]);
  calls.length = 0;
  assert.deepEqual(await getFeedPosts(db({ data: [], error: null })), [], 'an empty table needs no second query');
  assert.equal(calls.filter((c) => c[0] === 'gte').length, 0);
  await assert.rejects(getFeedPosts(db({ data: null, error: { message: 'permission denied' } })), /proc_feed_posts: permission denied/);
});

test('the stream is ordered by when a post was sent, not when it was last updated', () => {
  const posts = timeline([
    post('a', '2026-10-17T09:00:00Z', { published_at: '2026-10-17T01:00:00Z' }),
    post('b', '2026-10-17T02:00:00Z', { published_at: '2026-10-17T02:00:00Z' }),
    post('c', '2026-10-17T03:00:00Z', { published_at: '2026-10-17T00:30:00Z' }),
  ]);
  assert.deepEqual(posts.map((p) => p.author), ['b', 'a', 'c']);
});

test('the side panel counts posts, bloggers, media, Beijing hours and the busiest bloggers', () => {
  const s = summarize([
    post('sama', '2026-10-17T01:00:00Z', { published_at: '2026-10-17T01:00:00Z', media: [{ type: 'photo', url: 'https://www.amazingindex.com/media/x/a.jpg' }] }),
    post('Sama', '2026-10-17T02:10:00Z', { published_at: '2026-10-17T02:10:00Z', text_zh: '' }),
    post('karpathy', '2026-10-17T05:00:00Z', { published_at: '2026-10-17T05:00:00Z' }),
  ]);
  assert.equal(s.posts, 3);
  assert.equal(s.authors, 2);
  assert.equal(s.with_media, 1);
  assert.equal(s.translated, 2);
  assert.equal(s.latest_at, '2026-10-17T05:00:00Z');
  assert.equal(s.earliest_at, '2026-10-17T01:00:00Z');
  assert.equal(s.by_hour[9], 1); // 01:00Z = 09:00 Beijing
  assert.equal(s.by_hour[10], 1);
  assert.equal(s.by_hour[13], 1);
  assert.equal(s.by_hour.reduce((a, b) => a + b), 3);
  assert.deepEqual(s.top_authors.map((a) => [a.handle.toLowerCase(), a.posts]), [['sama', 2], ['karpathy', 1]]);
  assert.equal(s.top_authors[0].latest_at, '2026-10-17T02:10:00Z');
});

test('an empty window summarizes to zeros', () => {
  const s = summarize([]);
  assert.equal(s.posts, 0);
  assert.equal(s.latest_at, '');
  assert.deepEqual(s.top_authors, []);
});
