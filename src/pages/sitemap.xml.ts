import { getSitemapIndexEntries, renderSitemapIndex, sitemapResponse } from '../lib/sitemap';

export async function GET() {
  return sitemapResponse(renderSitemapIndex(await getSitemapIndexEntries()));
}
