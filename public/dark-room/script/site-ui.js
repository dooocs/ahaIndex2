// AmazingIndex adaptation, MPL-2.0. Keep utility controls out of the play area.
function setupGameUI() {
  var menu = document.querySelector('.menu');
  if (!menu || menu.dataset.settingsReady) return;
  menu.dataset.settingsReady = 'true';
  var host;
  try { host = window.parent !== window && window.parent.document.getElementById('dark-room-settings-host'); } catch (_) {}
  var settings = document.createElement('details');
  settings.className = 'game-settings';
  settings.innerHTML = '<summary class="menuBtn" aria-label="游戏设置" title="游戏设置"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg></summary><div class="settings-panel"><strong>游戏设置</strong><div class="settings-actions"></div><div class="settings-credit">A Dark Room<br>Michael Townsend 等</div><div class="settings-links"><a href="https://github.com/doublespeakgames/adarkroom" target="_blank" rel="noopener">原作</a><a href="https://github.com/dooocs/ahaIndex2/tree/main/public/dark-room" target="_blank" rel="noopener">源码</a><a href="/dark-room/LICENSE.md" target="_blank" rel="noopener">MPL-2.0</a></div></div>';
  if (host) {
    settings.classList.add('game-settings--embedded');
    settings.querySelector('summary').textContent = '设置';
    document.getElementById('saveNotify').hidden = true;
  }
  function label(text) {
    return text.replace('sound on.', '开启声音').replace('sound off.', '关闭声音');
  }
  ['.save', '.volume', '.lightsOff', '.restart'].forEach(function (selector) {
    var original = menu.querySelector(selector);
    if (!original) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'menuBtn';
    var updateLabel = function () { button.textContent = selector === '.save' ? '导入 / 导出' : label(original.textContent); };
    updateLabel();
    new MutationObserver(updateLabel).observe(original, { childList: true, characterData: true, subtree: true });
    button.addEventListener('click', function () {
      original.click();
      updateLabel();
      settings.open = false;
    });
    settings.querySelector('.settings-actions').appendChild(button);
  });
  if (host) host.replaceChildren(settings);
  else document.body.appendChild(settings);
  // Crafting lists grow as the game progresses. Grow the viewport vertically
  // without changing the fixed horizontal offsets used by the original engine.
  var stageQueued = false;
  var seenPanels = new WeakSet();
  var sizeObserver = new ResizeObserver(queueStage);
  function queueStage() {
    if (stageQueued) return;
    stageQueued = true;
    requestAnimationFrame(function () {
      stageQueued = false;
      document.querySelectorAll('.location').forEach(function (panel) {
        if (!seenPanels.has(panel)) { seenPanels.add(panel); sizeObserver.observe(panel); }
      });
      var active = Engine.activeModule && Engine.activeModule.panel;
      var panel = active && active[0];
      var root = document.documentElement;
      var main = panel && panel.parentElement.id === 'locationSlider';
      root.dataset.gamePanel = panel ? panel.id : '';
      root.toggleAttribute('data-game-main', Boolean(main));
      root.style.setProperty('--game-wrapper-left', document.getElementById('wrapper').getBoundingClientRect().left + 'px');
      if (main) root.style.setProperty('--game-panel-top', document.getElementById('locationSlider').getBoundingClientRect().top + 'px');
      var height = panel ? panel.getBoundingClientRect().height : 700;
      if (panel && panel.parentElement.id === 'locationSlider') {
        var panelTop = panel.getBoundingClientRect().top;
        document.querySelectorAll('#storesContainer, #village, #workers, #perks, #blueprints, #outfitting').forEach(function (box) {
          var rect = box.getBoundingClientRect();
          if (rect.height) height = Math.max(height, rect.bottom - panelTop);
        });
      }
      var header = document.getElementById('header');
      var headerHeight = panel && panel.parentElement.id === 'locationSlider' ? header.getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty('--game-stage-height', Math.ceil(Math.max(700, height + headerHeight + 16)) + 'px');
    });
  }
  new MutationObserver(queueStage).observe(document.getElementById('outerSlider'), {
    childList: true, subtree: true, attributes: true, attributeFilter: ['style']
  });
  window.addEventListener('resize', queueStage);
  window.addEventListener('scroll', queueStage, { passive: true });
  queueStage();
  function closeSettings(event) {
    if (!settings.contains(event.target)) settings.open = false;
  }
  document.addEventListener('click', closeSettings);
  if (host) {
    host.ownerDocument.addEventListener('click', closeSettings);
    window.addEventListener('pagehide', function () {
      host.ownerDocument.removeEventListener('click', closeSettings);
      settings.remove();
    });
  }
  settings.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { settings.open = false; settings.querySelector('summary').focus(); }
  });
}
window.addEventListener('dark-room-started', setupGameUI);
$(setupGameUI);
