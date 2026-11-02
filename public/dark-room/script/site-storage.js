// AmazingIndex adaptation, MPL-2.0. Only this game's keys may be reset.
(function () {
  var prefix = 'amazingindex.dark-room.';
  window.GameStorage = {
    clear: function () {
      ['gameState', 'lang'].forEach(function (key) { localStorage.removeItem(prefix + key); });
    }
  };
  ['gameState', 'lang'].forEach(function (key) {
    Object.defineProperty(GameStorage, key, {
      get: function () { return localStorage.getItem(prefix + key); },
      set: function (value) { localStorage.setItem(prefix + key, value); }
    });
  });
}());
