// Which province a visitor is in, from their IP, for a label over their head. Best effort: a wrong or
// missing answer only means the label says 未知.
//
// The lookup is a keyless JSONP service (太平洋网络 whois.pconline.com.cn). JSONP runs the provider's
// script, so it runs inside a sandboxed iframe with an opaque origin: it can post one message back
// and can't reach this site's storage, cookies or sign-in. The answer is cached for a day.

const KEY = 'dream:province', TTL = 24 * 3600e3;
const SUFFIX = /(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/;
const REGIONS = ['香港', '澳门', '台湾'];

/** "浙江省" → "浙江", "广西壮族自治区" → "广西"; a foreign address → "海外"; nothing → "未知". */
export function provinceName(pro, addr = '') {
  const p = String(pro || '').trim().replace(SUFFIX, '');
  if (p) return p;
  const a = String(addr || '').trim();
  const r = REGIONS.find(x => a.includes(x));
  if (r) return r;
  return a ? '海外' : '未知';
}

function cached() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && Date.now() - v.at < TTL) return v.name; } catch { /* storage blocked */ }
  return null;
}
function remember(name) { try { localStorage.setItem(KEY, JSON.stringify({ name, at: Date.now() })); } catch { /* storage blocked */ } }

export function lookupProvince({ timeout = 5000, src = 'https://whois.pconline.com.cn/ipJson.jsp' } = {}) {
  const hit = cached();
  if (hit) return Promise.resolve(hit);
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><script>
      var sent = false;
      function done(v) { if (!sent) { sent = true; parent.postMessage({ dreamProvince: v }, '*'); } }
      window.IPCallBack = function (d) { done(d ? { pro: d.pro, addr: d.addr } : null); };
    <\/script><script charset="gbk" src="${src}" onerror="done(null)" onload="setTimeout(function(){ done(null); }, 50)"><\/script>`;
    const finish = name => { removeEventListener('message', onMsg); clearTimeout(timer); frame.remove(); resolve(name); };
    const onMsg = e => {
      if (e.source !== frame.contentWindow || !e.data || !('dreamProvince' in e.data)) return;
      const v = e.data.dreamProvince, name = v ? provinceName(v.pro, v.addr) : '未知';
      if (v) remember(name);
      finish(name);
    };
    const timer = setTimeout(() => finish('未知'), timeout);
    addEventListener('message', onMsg);
    document.body.appendChild(frame);
  });
}
