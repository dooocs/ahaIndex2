// This guide does not open or change browser settings; the player does that.
const desktopSettings = {
  chrome: 'chrome://settings/system',
  edge: 'edge://settings/system',
};
export function webglGuide(browser = navigator) {
  const ua = String(browser.userAgent ?? '');
  const platform = String(browser.userAgentData?.platform || browser.platform || '');
  const mobile = browser.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    /Android|iOS/i.test(platform) || (/Mac/i.test(platform) && browser.maxTouchPoints > 1);
  if (mobile) return { steps: [
    '更新浏览器和系统到设备支持的最新版本。',
    '如果是在其他 App 内打开，请用系统浏览器打开。',
    '关闭浏览器后重新打开，再打开西湖飞车。',
  ] };

  const brands = (browser.userAgentData?.brands ?? []).map(({ brand }) => brand);
  const edge = brands.includes('Microsoft Edge') || /\bEdg\//.test(ua);
  const chrome = !browser.brave &&
    (brands.length ? brands.includes('Google Chrome') :
      /\bChrome\//.test(ua) && !/OPR\/|Vivaldi\/|YaBrowser\/|SamsungBrowser\//.test(ua));
  const address = edge ? desktopSettings.edge : chrome ? desktopSettings.chrome : null;
  if (address) return { address, steps: [
    '复制下面的设置地址，粘贴到浏览器顶部的地址栏，按回车。',
    '打开「使用图形加速功能（如果可用）」。',
    '完全退出并重新打开浏览器，再进入西湖飞车。',
  ] };
  if (/Firefox\//.test(ua)) return { steps: [
    '打开 Firefox 的「设置」→「常规」→「性能」。',
    '如果看不到硬件加速选项，取消勾选「使用推荐的性能设置」，再开启「使用硬件加速（如果可用）」。',
    '完全退出并重新打开 Firefox，再进入西湖飞车。',
  ] };
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\//.test(ua)) return { steps: [
    '打开「系统设置」→「通用」→「软件更新」，更新 macOS 和 Safari。',
    '完全退出并重新打开 Safari，再进入西湖飞车。',
    '如果仍无法启动，可试试最新版 Chrome 或 Edge。',
  ] };
  return { steps: [
    '更新浏览器和系统到设备支持的最新版本。',
    '完全退出并重新打开浏览器，再进入西湖飞车。',
    '如果仍无法启动，可试试最新版 Chrome、Edge 或 Firefox。',
  ] };
}

export function wireWebGLHelp(doc = document, browser = navigator) {
  const detail = webglGuide(browser);
  const byId = id => doc.getElementById(id);
  byId('webgl-steps').replaceChildren(...detail.steps.map(text => {
    const step = doc.createElement('li');
    step.textContent = text;
    return step;
  }));
  if (!detail.address) return;
  const address = byId('webgl-address');
  const feedback = byId('webgl-feedback');
  address.value = detail.address;
  byId('webgl-settings').hidden = false;
  byId('webgl-copy').addEventListener('click', async () => {
    try {
      await browser.clipboard.writeText(detail.address);
      feedback.textContent = '已复制。请粘贴到浏览器地址栏。';
    } catch {
      address.focus();
      address.select();
      feedback.textContent = '地址已选中，请手动复制，再粘贴到浏览器地址栏。';
    }
  });
}
