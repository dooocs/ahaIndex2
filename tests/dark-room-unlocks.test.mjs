import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function roomGame(state) {
  const storage = new Map([['amazingindex.dark-room.gameState', JSON.stringify(state)]]);
  const notifications = [];
  const dom = { css() { return this; }, animate() { return this; } };
  const jquery = Object.assign(() => dom, { Dispatch: () => ({ publish() {} }) });
  const context = vm.createContext({
    _: text => text, $: jquery, Storage: function () {}, AudioLibrary: {},
    Notifications: { notify: (_room, text) => notifications.push(text) },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
  });
  context.window = context;
  for (const script of ['site-storage', 'engine', 'state_manager', 'room']) {
    vm.runInContext(readFileSync(new URL(`../public/dark-room/script/${script}.js`, import.meta.url), 'utf8'), context);
  }
  context.$.Dispatch = () => ({ publish() {} });
  context.Engine.loadGame();
  return { context, notifications, saved: () => JSON.parse(context.GameStorage.gameState) };
}

const state = (stores, buildings = {}) => ({ version: 1.3, stores, game: { builder: { level: 4 }, buildings } });

test('discovered buildings survive resource spending and a full save/load cycle', () => {
  const first = roomGame(state({ wood: 250, fur: 9, meat: 5 }));
  assert.equal(first.context.Room.craftUnlocked('trading post'), true);
  assert.equal(first.context.Room.craftUnlocked('lodge'), true);
  first.context.$SM.set('stores.wood', 28);
  first.context.$SM.set('stores.fur', 0);
  const reloaded = roomGame(first.saved());
  assert.equal(reloaded.context.Room.craftUnlocked('trading post'), true);
  assert.equal(reloaded.context.Room.craftUnlocked('lodge'), true);
  assert.equal(reloaded.context.State.stores.wood, 28);
  assert.equal(reloaded.context.State.stores.fur, 0);
  assert.deepEqual(reloaded.notifications, [], 'restoring a discovery does not announce it again');
});

test('new discoveries enter the local save immediately and do not unlock future buildings', () => {
  const game = roomGame(state({ wood: 200, fur: 1 }));
  assert.equal(game.context.Room.craftUnlocked('trading post'), true);
  assert.equal(game.saved().features.craftables['trading post'], true);
  assert.equal(game.context.Room.craftUnlocked('tannery'), false);
  assert.equal(game.context.Room.craftUnlocked('workshop'), false);
  assert.equal(game.notifications.length, 1);
});

test('older saves retain their original discovery thresholds and restore built buildings', () => {
  const game = roomGame(state({ wood: 28, fur: 9 }, { cart: 1, hut: 3, 'trading post': 1 }));
  assert.equal(game.context.Room.craftUnlocked('trading post'), true);
  assert.equal(game.saved().features.craftables['trading post'], true);
  assert.equal(game.context.Room.craftUnlocked('lodge'), false);
  assert.equal(game.context.Room.craftUnlocked('tannery'), false);
});

test('a new game has no discoveries from the previous game', () => {
  const game = roomGame(state({ wood: 28, fur: 9 }));
  assert.equal(game.context.Room.craftUnlocked('trading post'), false);
  assert.equal(game.context.Room.craftUnlocked('workshop'), false);
});
