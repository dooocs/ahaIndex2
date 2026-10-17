import assert from 'node:assert/strict';
import test from 'node:test';
import { beijingTime, getFeedPosts, groupByAuthor, linkLabel, normalizePost, renderPostText } from '../src/lib/feed.ts';

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

test('the query reads the last 24 hours, newest first, and fails loudly', async () => {
  const calls = [];
  const db = (result) => ({
    from(table) {
      const q = {
        select(cols) { calls.push(['from', table, cols]); return q; },
        gte(col, value) { calls.push(['gte', col, value]); return q; },
        order(col, opts) { calls.push(['order', col, opts.ascending]); return q; },
        limit(n) { calls.push(['limit', n]); return Promise.resolve(result); },
      };
      return q;
    },
  });
  const now = new Date('2026-10-17T10:00:00Z');
  const rows = await getFeedPosts(db({ data: [{ id: 'a', author: 'sama', updated_at: '2026-10-17T09:00:00Z' }], error: null }), now);
  assert.equal(rows[0].display_name, 'sama');
  assert.deepEqual(calls.slice(1, 3), [['gte', 'updated_at', '2026-10-16T10:00:00.000Z'], ['order', 'updated_at', false]]);
  await assert.rejects(getFeedPosts(db({ data: null, error: { message: 'permission denied' } }), now), /proc_feed_posts: permission denied/);
});
