import test from 'node:test';
import assert from 'node:assert/strict';
import { webglGuide } from '../public/race/js/webgl-help-1.js';

test('desktop Chrome and Edge receive their own copyable settings address', () => {
  const chrome = webglGuide({ userAgent: 'Mozilla/5.0 Chrome/157.0.0.0 Safari/537.36', platform: 'MacIntel' });
  const edge = webglGuide({ userAgent: 'Mozilla/5.0 Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0', platform: 'Win32' });
  assert.equal(chrome.address, 'chrome://settings/system');
  assert.equal(edge.address, 'edge://settings/system');
  for (const { steps } of [chrome, edge]) assert.equal(steps.length, 3);
});

test('mobile, desktop-mode iPad and other browsers are not directed to incompatible settings', () => {
  for (const browser of [
    { userAgent: 'Android Chrome/157.0 Mobile Safari/537.36' },
    { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
    { userAgent: 'Chrome/157.0 Edg/157.0', userAgentData: { platform: 'Android' } },
    { userAgent: 'Chrome/157.0 OPR/99.0' },
    { userAgent: 'Chrome/157.0', brave: {} },
    { userAgent: 'Chrome/157.0', userAgentData: { brands: [{ brand: 'Chromium' }] } },
  ]) assert.equal(webglGuide(browser).address, undefined);
});

test('desktop Firefox and Safari get relevant ordinary settings without links to internal pages', () => {
  const firefox = webglGuide({ userAgent: 'Gecko/20100101 Firefox/146.0', platform: 'Win32' });
  const safari = webglGuide({ userAgent: 'AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel' });
  assert.match(firefox.steps.join(' '), /常规.*性能/);
  assert.match(safari.steps.join(' '), /软件更新/);
  assert.equal(firefox.address, undefined);
  assert.equal(safari.address, undefined);
});
