import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function game(saved) {
  const values = new Map([['unrelated.login', 'keep']]);
  if (saved !== undefined) values.set('amazingindex.dark-room.gameState', saved);
  const context = vm.createContext({
    _: text => text,
    $: () => {},
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
  });
  context.window = context;
  vm.runInContext(readFileSync(new URL('../public/dark-room/script/site-storage.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../public/dark-room/script/engine.js', import.meta.url), 'utf8'), context);
  context.$SM = { set: (key, value) => { context.State[key] = value; }, updateOldState: () => {} };
  context.Engine.event = () => {};
  context.Engine.log = () => {};
  return { context, values };
}

for (const saved of [undefined, 'null', '{}broken', '[]', 'false', '7']) {
  test(`dark room creates initial state for ${String(saved)} save`, () => {
    const { context, values } = game(saved);
    context.Engine.loadGame();
    assert.equal(context.State.version, context.Engine.VERSION);
    assert.equal(values.get('unrelated.login'), 'keep');
  });
}

test('dark room restores an existing save and resets only its own storage', () => {
  const { context, values } = game('{"stores":{"wood":42}}');
  context.Engine.loadGame();
  assert.equal(context.State.stores.wood, 42);
  context.GameStorage.clear();
  assert.equal(values.get('unrelated.login'), 'keep');
  assert.equal(context.GameStorage.gameState, null);
});

test('account saves isolate progress while retaining the browser language', () => {
  const { context, values } = game('{"version":1.3,"stores":{"wood":42}}');
  context.GameStorage.lang = 'zh_cn';
  context.GameStorage.useAccount('11111111-1111-4111-8111-111111111111');
  assert.equal(context.GameStorage.gameState, null);
  assert.equal(context.GameStorage.lang, 'zh_cn');
  context.GameStorage.gameState = '{"version":1.3,"stores":{"wood":99}}';
  assert.equal(JSON.parse(values.get('amazingindex.dark-room.gameState')).stores.wood, 42);
  context.GameStorage.clear();
  assert.equal(context.GameStorage.gameState, null);
  assert.equal(JSON.parse(values.get('amazingindex.dark-room.gameState')).stores.wood, 42);
});
