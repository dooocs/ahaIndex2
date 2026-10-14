"""Refresh the Alibaba Cloud CDN cache for www.amazingindex.com.

python3 scripts/refresh-cdn.py --directory        # whole site (full deploys)
python3 scripts/refresh-cdn.py --urls FILE        # one URL per line (daily deploys)

Credentials: ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET,
falling back to OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET.
Requires: pip install alibabacloud_cdn20180510
"""
import argparse
import os

from alibabacloud_cdn20180510 import models as cdn_models
from alibabacloud_cdn20180510.client import Client
from alibabacloud_tea_openapi import models as open_api_models

SITE = 'https://www.amazingindex.com/'
BATCH = 100  # URLs per RefreshObjectCaches request


def client() -> Client:
    key_id = os.environ.get('ALIBABA_CLOUD_ACCESS_KEY_ID') or os.environ['OSS_ACCESS_KEY_ID']
    secret = os.environ.get('ALIBABA_CLOUD_ACCESS_KEY_SECRET') or os.environ['OSS_ACCESS_KEY_SECRET']
    return Client(open_api_models.Config(access_key_id=key_id, access_key_secret=secret, endpoint='cdn.aliyuncs.com'))


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--directory', action='store_true')
    group.add_argument('--urls')
    args = parser.parse_args()
    cdn = client()

    if args.directory:
        cdn.refresh_object_caches(cdn_models.RefreshObjectCachesRequest(object_path=SITE, object_type='Directory'))
        print('Refreshed entire site directory')
        return

    with open(args.urls, encoding='utf-8') as handle:
        urls = [line.strip() for line in handle if line.strip()]
    for url in urls:
        if not url.startswith(SITE):
            raise SystemExit(f'Refusing to refresh a URL outside the site: {url}')
    for start in range(0, len(urls), BATCH):
        batch = urls[start:start + BATCH]
        cdn.refresh_object_caches(cdn_models.RefreshObjectCachesRequest(object_path='\n'.join(batch), object_type='File'))
    print(f'Refreshed {len(urls)} URLs in {(len(urls) + BATCH - 1) // BATCH} request(s)')


if __name__ == '__main__':
    main()
