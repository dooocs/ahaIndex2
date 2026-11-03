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
