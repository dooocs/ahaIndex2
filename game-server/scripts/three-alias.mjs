// 让 Node 能直接 import 游戏前端的 public/race/js/*.js：它们用裸模块名 'three'，
// 浏览器靠 import map 指向仓库里自带的 three r170，这里在 Node 里做同样的映射。
// 用法：node --import ./scripts/three-alias.mjs <脚本>
import { register } from 'node:module';

const THREE_URL = new URL('../../public/dream/vendor/three-r170/three.module.min.js', import.meta.url).href;
const hook = `export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);
