// AmazingIndex adaptation, MPL-2.0. Optional village relationships, saved with the game.
var Companions = (function () {
  'use strict';
  var M = CompanionModel, dialogEvent = null, panel = null, backdrop = null, closing = false;
  var timer = null, returnFocus = null, encounterOpen = false;
  var labels = {
    gender: { female: '女性', male: '男性', any: '都可以', off: '暂时不考虑' },
    ages: { '19-21': '19～21岁', '22-29': '22～29岁', '30-35': '30～35岁', '36-41': '36～41岁' },
    heights: { short: '偏矮（≤164cm）', medium: '中等（165～174cm）', tall: '高挑（≥175cm）' },
    bodies: { slim: '纤细、清瘦', balanced: '匀称', full: '体格厚实', athletic: '健美、结实' },
    temperaments: { assertive: '强势、果断', gentle: '温柔、细腻', lively: '开朗、主动', reserved: '清冷、慢热', mature: '成熟、从容' },
    approaches: { lead: '喜欢主导', equal: '互相照顾', follow: '偏被带领' }
  };
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function read() { return M.normalize($SM.get('game.companions')); }
  function save(state) { $SM.set('game.companions', state); }
  function notice(text) { Notifications.notify(Room, text); }
  function isOpen() { return !!dialogEvent; }
  function safeLocation() { return Engine.activeModule === Room || Engine.activeModule === Outside; }
  function supported() {
    var raw = $SM.get('game.companions');
    return !raw || !raw.version || raw.version === 1;
  }
  function button(text, action, name) {
    var b = el('button', text, 'companion-button'); b.type = 'button';
    if (name) b.dataset.companionAction = name;
    b.addEventListener('click', function () {
      if (closing) return;
      try { action(); } catch (error) { showError(error.message || '请关闭窗口后重试。'); }
    });
    return b;
  }
  function showError(text) {
    if (!panel) { notice(text); return; }
    var error = panel.querySelector('.companion-error');
    if (!error) { error = el('p', '', 'companion-error'); error.setAttribute('role', 'alert'); panel.querySelector('#description').appendChild(error); }
    error.textContent = text;
  }
  function reset(title) {
    panel.querySelector('.eventTitle').textContent = title;
    var body = panel.querySelector('#description'), actions = panel.querySelector('#buttons');
    body.replaceChildren(); actions.replaceChildren();
    panel.scrollTop = 0;
    return { body: body, actions: actions };
  }
  function close(defer) {
    if (!isOpen() || closing || Events.activeEvent() !== dialogEvent) return;
    if (defer !== false && encounterOpen) save(M.defer(read(), Date.now()));
    closing = true;
    var closingPanel = Events.eventPanel();
    Events.endEvent();
    // Finish the engine's event teardown before allowing another dialog to open.
    // Do not guess its completion using a separate wall-clock timeout.
    closingPanel.stop(true, true);
    if (backdrop) backdrop.remove(); backdrop = null;
    dialogEvent = null; panel = null; closing = false; encounterOpen = false;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }
  function open(render, automatic) {
    if (isOpen() || Events.activeEvent() || !safeLocation()) {
      if (!automatic) notice('先结束当前事件，回到小屋或村落后再看看吧。');
      return false;
    }
    if (!supported()) { if (!automatic) notice('这份伴侣进度来自较新的游戏版本，请刷新后再试。'); return false; }
    returnFocus = document.activeElement;
    try {
      var parentActive = window.parent.document.activeElement;
      if (window.parent !== window && parentActive && parentActive.tagName !== 'IFRAME') returnFocus = parentActive;
    } catch (_) {}
    dialogEvent = { title: '炉火旁', scenes: { start: { text: [], buttons: {} } } };
    Events.startEvent(dialogEvent);
    Events.eventPanel().stop(true, true).css('opacity', 1);
    backdrop = el('div', null, 'companion-backdrop');
    backdrop.setAttribute('aria-hidden', 'true'); document.body.appendChild(backdrop);
    panel = Events.eventPanel()[0];
    panel.classList.add('companion-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.querySelector('.eventTitle').id = 'companion-dialog-title';
    panel.setAttribute('aria-labelledby', 'companion-dialog-title');
    // Follow the current game palette, including the original lights-off stylesheet.
    var background = getComputedStyle(document.body).backgroundColor;
    panel.style.setProperty('--companion-background', background === 'rgba(0, 0, 0, 0)' || background === 'transparent' ? '#fff' : background);
    var exit = button('× 关闭', function () { close(); }, 'close');
    exit.classList.add('companion-close'); exit.setAttribute('aria-label', '关闭伴侣窗口，稍后再说');
    panel.insertBefore(exit, panel.firstChild);
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== 'Tab') return;
      var focusable = Array.from(panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select, summary')).filter(function (node) { return node.getClientRects().length; });
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    render();
    requestAnimationFrame(function () { if (panel) exit.focus(); });
    return true;
  }
  function meta(p) { return (p.gender === 'female' ? '女性' : '男性') + ' · ' + p.age + '岁 · ' + p.height + 'cm · ' + p.body; }
  function profileText(body, p, familiar) {
    body.appendChild(el('p', meta(p), 'companion-meta'));
    body.appendChild(el('p', p.appearance, 'companion-prose'));
    body.appendChild(el('p', p.name + p.goal + '。', 'companion-goal'));
    if (familiar) {
      body.appendChild(el('p', p.familiar, 'companion-prose'));
      body.appendChild(el('p', p.quote, 'companion-quote'));
    }
  }
  function preferencesView() {
    var ui = reset('你更愿意和谁发展一段关系？'), state = read();
    ui.body.appendChild(el('p', '炉火旁渐渐有了熟悉的面孔。选择你想认识的人，也可以暂时把心思放在村落上。'));
    var form = el('form'); form.id = 'companion-preferences';
    function group(key, title, type, choices) {
      var field = el('fieldset'); field.appendChild(el('legend', title));
      Object.keys(choices).forEach(function (value) {
        var label = el('label', null, 'companion-choice'), input = el('input');
        input.type = type; input.name = key; input.value = value;
        input.checked = type === 'radio' ? state.preferences.gender === value : state.preferences[key].indexOf(value) !== -1;
        label.append(input, document.createTextNode(choices[value])); field.appendChild(label);
      });
      return field;
    }
    form.appendChild(group('gender', '想认识谁', 'radio', labels.gender));
    var more = el('details', null, 'companion-more'); more.appendChild(el('summary', '更多偏好（可选）'));
    more.appendChild(el('p', '年龄可多选，不选表示不限。其他偏好会让更合你心意的人更常出现。', 'companion-muted'));
    [['ages', '年龄范围'], ['heights', '身高'], ['bodies', '体态'], ['temperaments', '性格'], ['approaches', '相处方式']].forEach(function (pair) {
      more.appendChild(group(pair[0], pair[1], 'checkbox', labels[pair[0]]));
    });
    form.appendChild(more); ui.body.appendChild(form);
    var submit = button('保存偏好', function () { form.requestSubmit(); }, 'save-preferences');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      try {
        var values = new FormData(form), pref = { gender: values.get('gender') };
        Object.keys(M.options).forEach(function (key) { pref[key] = values.getAll(key); });
        save(M.setPreferences(read(), pref, Date.now()));
        encounterOpen = false; managerView();
      } catch (error) { showError(error.message); }
    });
    ui.actions.append(submit, button('稍后再说', function () { close(); }, 'later'));
  }
  function remaining(at) { return Math.max(1, Math.ceil((at - Date.now()) / 60000)) + '分钟'; }
  function managerView() {
    var ui = reset('炉火旁 · 伴侣与偏好'), s = read();
    var pref = s.preferences, summary = pref.gender ? labels.gender[pref.gender] : '尚未选择';
    if (pref.ages.length) summary += ' · ' + pref.ages.map(function (key) { return labels.ages[key]; }).join('、');
    ui.body.appendChild(el('p', '想认识：' + summary, 'companion-meta'));
    ui.body.appendChild(button('调整偏好', preferencesView, 'preferences'));
    if (!M.unlocked(State)) ui.body.appendChild(el('p', '建起第一间小屋，等村落迎来居民后，新的邂逅就会出现。', 'companion-muted'));
    else if (s.partnerId) {
      ui.body.appendChild(el('p', '你已经与' + M.person(s.partnerId).name + '确定伴侣关系。一起把往后的日子过好吧。'));
    } else if (!pref.gender || pref.gender === 'off') ui.body.appendChild(el('p', '你可以随时在这里开启伴侣邀约。', 'companion-muted'));
    else {
      var next = M.choose(s);
      if (next) {
        var discover = button(s.pendingId ? '继续上次的邀约' : '看看村落里的新面孔', function () { startInvite(); }, 'discover');
        discover.dataset.readyAt = s.nextEncounterAt;
        discover.disabled = Date.now() < s.nextEncounterAt;
        ui.body.appendChild(discover);
        if (discover.disabled) ui.body.appendChild(el('p', '先忙一会儿各自的事，约' + remaining(s.nextEncounterAt) + '后会有新的机会。', 'companion-muted'));
      } else ui.body.appendChild(el('p', '当前偏好下暂时没有新的邀约。可以继续认识熟悉的人，也可以调整偏好。', 'companion-muted'));
    }
    var known = CompanionRoster.filter(function (p) { return s.people[p.id] && s.people[p.id].status === 'known'; });
    if (known.length) ui.body.appendChild(el('h3', '已经认识的人'));
    known.sort(function (a, b) { return (b.id === s.partnerId ? 1 : 0) - (a.id === s.partnerId ? 1 : 0); }).forEach(function (p) {
      var row = el('div', null, 'companion-person');
      var stage = p.id === s.partnerId ? '伴侣' : s.partnerId ? '朋友' : ['初识', '熟悉', '亲近'][s.people[p.id].level - 1];
      row.append(el('strong', p.name + ' · ' + stage), el('span', meta(p), 'companion-meta'));
      var detail = button('查看人物', function () { profileView(p.id); }, 'profile'); detail.dataset.companionId = p.id;
      row.appendChild(detail); ui.body.appendChild(row);
    });
    ui.actions.appendChild(button('回到村落', function () { close(); }, 'close-manager'));
  }
  function inviteView(id) {
    var p = M.person(id), ui = reset('炉火旁的新面孔 · ' + p.name);
    encounterOpen = true;
    ui.body.appendChild(el('p', '村落安顿下来后，你与' + p.name + '有了说话的机会。对方愿意与你一起坐坐，聊聊近况。'));
    ui.body.appendChild(el('p', meta(p), 'companion-meta'));
    ui.body.appendChild(el('p', p.appearance.split('。')[0] + '。', 'companion-prose'));
    ui.body.appendChild(el('p', '接受这次邀约，先从认识彼此开始。', 'companion-muted'));
    ui.actions.append(
      button('了解对方', function () { profileView(id, true); }, 'details'),
      button('接受邀约', function () { acceptInvite(id); }, 'accept'),
      button('婉拒', function () {
        save(M.decline(read(), id, Date.now())); encounterOpen = false;
        notice('你婉拒了' + p.name + '的邀约。往后仍有认识其他人的机会。'); close(false);
      }, 'decline')
    );
  }
  function startInvite() {
    var s = read();
    if (!M.unlocked(State) || Date.now() < s.nextEncounterAt) return;
    var p = M.choose(s); if (!p) return;
    save(M.invite(s, p.id, Date.now())); inviteView(p.id);
  }
  function acceptInvite(id) {
    var p = M.person(id); save(M.accept(read(), id, Date.now())); encounterOpen = false;
    var ui = reset('初次交谈 · ' + p.name);
    ui.body.appendChild(el('p', '你接受了邀约。你们在炉火旁聊起各自的经历，慢慢记住了对方的名字。'));
    ui.body.appendChild(el('p', p.name + p.goal + '。下次有机会，你们可以一起做些事情。'));
    ui.actions.appendChild(button('期待下次见面', function () { close(false); }, 'finish-accept'));
    notice('你认识了' + p.name + '。可以在“伴侣与偏好”里继续了解彼此。');
  }
  function profileView(id, invited) {
    var s = read(), p = M.person(id), r = s.people[id];
    if (!p || !r) { managerView(); return; }
    save(M.view(s, id)); s = read(); r = s.people[id];
    var ui = reset('了解对方 · ' + p.name);
    profileText(ui.body, p, r.level >= 2 && (!s.partnerId || s.partnerId === id));
    if (invited && r.status === 'invited') {
      ui.actions.append(button('接受邀约', function () { acceptInvite(id); }, 'accept'), button('返回邀约', function () { inviteView(id); }, 'back-invite'));
      return;
    }
    var partner = s.partnerId === id;
    if (r.status === 'known' && (!s.partnerId || partner)) {
      var spend = button(partner ? '一起过日子' : '相处一下', function () { interactionView(id); }, 'interact');
      spend.dataset.readyAt = r.nextInteractionAt;
      spend.disabled = !M.canInteract(s, id, Date.now()); ui.actions.appendChild(spend);
      if (spend.disabled) ui.body.appendChild(el('p', '各自忙完手头的事，约' + remaining(r.nextInteractionAt) + '后再来相处。', 'companion-muted'));
      if (r.level >= 3 && !s.partnerId) ui.actions.appendChild(button('认真谈谈我们的关系', function () { confirmView(id); }, 'confirm-partner'));
      if (partner && !r.homeReady) ui.actions.appendChild(button('一起布置小屋', function () {
        save(M.prepareHome(read(), id));
        storyView('属于你们的小屋', '你和' + p.name + '一起添了一盏灯、修好两把椅子，把各自珍惜的小东西摆在炉火旁。这间小屋开始有了两个人生活的痕迹。', function () { profileView(id); });
      }, 'prepare-home'));
      if (partner && r.homeReady) ui.body.appendChild(el('p', '小屋已经一起布置好，炉火旁留着你们的位置。', 'companion-muted'));
    }
    ui.actions.appendChild(button('返回人物列表', managerView, 'back-manager'));
  }
  function storyView(title, text, done) {
    var ui = reset(title); ui.body.appendChild(el('p', text, 'companion-prose'));
    ui.actions.appendChild(button('记住这一刻', done, 'finish-story'));
  }
  function interactionView(id) {
    var p = M.person(id), result = M.interact(read(), id, Date.now()); save(result.state);
    var text, title;
    if (result.partner) {
      var moments = [
        '你们一起准备了一顿简单的晚饭，轮流讲起今天遇见的人和事。饭后，' + p.name + '把椅子挪到你身边，与你一起看炉火慢慢安静下来。',
        '你陪' + p.name + '处理一直惦记的事情。彼此已经很熟悉，仍会认真听对方把想法说完。你们约定，明天还要为各自的目标留一点时间。',
        '傍晚，你们沿村落走了一圈。' + p.name + '聊起初次见面时对你的印象，讲到一半先笑了起来。你们把回去的路走得很慢。'
      ];
      title = '一起过日子 · ' + p.name; text = moments[(result.visit - 1) % moments.length];
    } else if (result.episode === 0) { title = '一起做些事情 · ' + p.name; text = p.episode; }
    else if (result.episode === 1) { title = '慢慢靠近 · ' + p.name; text = p.familiar + '\n\n' + p.quote; }
    else { title = '聊聊未来 · ' + p.name; text = '你们聊起想过怎样的生活，也谈到各自仍想完成的事。' + p.name + '认真询问你的想法，愿意与你一起考虑往后的日子。'; }
    storyView(title, text, function () { profileView(id); });
    notice('你和' + p.name + '又多了一段共同的回忆。');
  }
  function confirmView(id) {
    var p = M.person(id), s = read();
    if (s.partnerId || !s.people[id] || s.people[id].level < 3) { managerView(); return; }
    var ui = reset('认真确定关系 · ' + p.name);
    ui.body.appendChild(el('p', '相处之后，你们都愿意把这段关系向前推进。你是否愿意与' + p.name + '成为伴侣，一起经营今后的生活？'));
    ui.body.appendChild(el('p', '确定之后，其他已认识的人仍是朋友，新的伴侣邀约会停止。', 'companion-muted'));
    ui.actions.append(button('愿意，一起生活', function () {
      save(M.commitPartner(read(), id, Date.now())); encounterOpen = false;
      notice('你与' + p.name + '确定了伴侣关系。');
      storyView('炉火旁，多了一个位置', '你们认真说出了彼此的心意，也约定继续尊重各自的目标。从今天起，忙碌归来时，有人与你分享这间小屋和往后的日子。', function () { profileView(id); });
    }, 'commit-partner'), button('再相处一段时间', function () { profileView(id); }, 'wait-partner'));
  }
  function tick() {
    if (panel) panel.querySelectorAll('button[data-ready-at]').forEach(function (b) {
      b.disabled = Date.now() < Number(b.dataset.readyAt);
    });
    if (document.hidden || isOpen() || Events.activeEvent() || Engine.keyLock || !safeLocation() || !supported() || !M.unlocked(State)) return;
    var s = read(), now = Date.now();
    if (!s.prompted) {
      s.prompted = true; s.nextEncounterAt = now + M.ENCOUNTER_DELAY; save(s);
      encounterOpen = false; open(preferencesView, true); return;
    }
    if (!s.preferences.gender || s.preferences.gender === 'off' || s.partnerId || now < s.nextEncounterAt) return;
    var known = CompanionRoster.filter(function (p) { return M.matches(p, s.preferences) && M.canInteract(s, p.id, now); });
    var candidate = M.choose(s);
    if (candidate && (Object.keys(s.people).filter(function (id) { return s.people[id].status === 'known'; }).length < 6) && (!known.length || Math.random() < 0.5)) {
      open(function () { startInvite(); }, true);
    } else if (known.length) {
      var p = known[Math.floor(Math.random() * known.length)];
      save(M.defer(s, now));
      open(function () {
        var ui = reset('又见面了 · ' + p.name);
        ui.body.appendChild(el('p', p.name + '忙完了手头的事，想邀你一起坐坐。'));
        ui.actions.append(button('相处一下', function () { interactionView(p.id); }, 'interact'), button('了解对方', function () { profileView(p.id); }, 'details'), button('稍后再说', function () { close(false); }, 'later'));
      }, true);
    }
  }
  function init(menu) {
    if (menu && !menu.querySelector('[data-companion-action="manager"]')) {
      var entry = button('伴侣与偏好', function () {
        var settings = entry.closest('details'); if (settings) settings.open = false;
        open(function () { var s = read(); if (!s.preferences.gender) preferencesView(); else managerView(); }, false);
      }, 'manager');
      entry.className = 'menuBtn'; menu.appendChild(entry);
    }
    if (timer) return;
    timer = window.setInterval(tick, 10000);
    window.setTimeout(tick, 1500);
    window.addEventListener('pagehide', function () { window.clearInterval(timer); timer = null; });
  }
  return Object.freeze({ init: init, tick: tick, isOpen: isOpen, close: close });
}());
