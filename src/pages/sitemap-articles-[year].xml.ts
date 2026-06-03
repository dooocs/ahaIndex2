import {
  getArticleSitemapEntriesByYear,
  getArticleSitemapYears,
  renderUrlset,
  sitemapResponse,
} from '../lib/sitemap';

export async function getStaticPaths() {
  const years = await getArticleSitemapYears();
  return years.map((year) => ({ params: { year } }));
}

export async function GET({ params }: { params: { year: string } }) {
  return sitemapResponse(renderUrlset(await getArticleSitemapEntriesByYear(params.year)));
}
