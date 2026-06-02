import { absoluteUrl, getArticleSitemapYears } from '../lib/sitemap';

export async function GET() {
  const years = await getArticleSitemapYears();
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${absoluteUrl('/sitemap-pages.xml')}`,
    ...years.map((year) => `Sitemap: ${absoluteUrl(`/sitemap-articles/${year}.xml`)}`),
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
