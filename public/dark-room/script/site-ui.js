// AmazingIndex adaptation, MPL-2.0. Keep utility controls out of the play area.
$(function () {
  var menu = document.querySelector('.menu');
  if (!menu) return;
  var settings = document.createElement('details');
  settings.className = 'game-settings';
  settings.innerHTML = '<summary class="menuBtn" aria-label="游戏设置" title="游戏设置"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg></summary><div class="settings-panel"><strong>游戏设置</strong><div class="settings-actions"></div><div class="settings-credit">A Dark Room<br>Michael Townsend &amp; contributors</div><div class="settings-links"><a href="https://github.com/doublespeakgames/adarkroom" target="_blank" rel="noopener">原作</a><a href="https://github.com/dooocs/ahaIndex2/tree/main/public/dark-room" target="_blank" rel="noopener">源码</a><a href="LICENSE.md" target="_blank" rel="noopener">MPL-2.0</a></div></div>';
  function label(text) {
    return text.replace('sound on.', '开启声音').replace('sound off.', '关闭声音');
  }
  ['.save', '.volume', '.lightsOff', '.restart'].forEach(function (selector) {
    var original = menu.querySelector(selector);
    if (!original) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'menuBtn';
    var updateLabel = function () { button.textContent = selector === '.save' ? '存档 / 备份' : label(original.textContent); };
    updateLabel();
    new MutationObserver(updateLabel).observe(original, { childList: true, characterData: true, subtree: true });
    button.addEventListener('click', function () {
      original.click();
      updateLabel();
      settings.open = false;
    });
    settings.querySelector('.settings-actions').appendChild(button);
  });
  document.body.appendChild(settings);
  document.addEventListener('click', function (event) {
    if (!settings.contains(event.target)) settings.open = false;
  });
  settings.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { settings.open = false; settings.querySelector('summary').focus(); }
  });
});
