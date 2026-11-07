// AmazingIndex adaptation, MPL-2.0. Only this game's keys may be reset.
(function () {
  var prefix = 'amazingindex.dark-room.';
  var guestPrefix = prefix;
  window.GameStorage = {
    useAccount: function (owner) {
      if (owner && !/^[0-9a-f-]{36}$/i.test(owner)) throw new Error('Invalid account');
      prefix = owner ? guestPrefix + 'user.' + owner + '.' : guestPrefix;
    },
    notifyOperation: function (operation) {
      if (window.parent !== window) window.parent.postMessage({ type: 'dark-room:operation', operation: operation, state: JSON.parse(GameStorage.gameState) }, location.origin);
    },
    boot: function (start) {
      var started = false;
      window.DarkRoomGame = {
        start: function (owner) {
          if (started) return;
          started = true;
          GameStorage.useAccount(owner);
          start();
          window.dispatchEvent(new Event('dark-room-started'));
          var operation = localStorage.getItem(prefix + 'gameState.operation');
          if (operation === 'import') {
            Engine.saveGame();
            localStorage.removeItem(prefix + 'gameState.operation');
            GameStorage.notifyOperation('import');
          }
        },
        snapshot: function () {
          if (!started) return null;
          Engine.saveGame();
          return JSON.parse(GameStorage.gameState);
        }
      };
      if (window.parent !== window && new URLSearchParams(location.search).get('embedded') === '1') {
        window.parent.postMessage({ type: 'dark-room:ready', url: location.href }, location.origin);
      } else window.DarkRoomGame.start(null);
    },
    clear: function () {
      ['gameState', 'lang'].forEach(function (key) { localStorage.removeItem(prefix + key); });
    }
  };
  GameStorage.markImport = function () { localStorage.setItem(prefix + 'gameState.operation', 'import'); };
  ['gameState', 'lang'].forEach(function (key) {
    Object.defineProperty(GameStorage, key, {
      get: function () { return localStorage.getItem(prefix + key); },
      set: function (value) { localStorage.setItem(prefix + key, value); }
    });
  });
}());
