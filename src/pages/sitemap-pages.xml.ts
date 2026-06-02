import { getPagesSitemapEntries, renderUrlset, sitemapResponse } from '../lib/sitemap';

export async function GET() {
  return sitemapResponse(renderUrlset(await getPagesSitemapEntries()));
}
