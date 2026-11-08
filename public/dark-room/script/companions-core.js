// AmazingIndex adaptation, MPL-2.0. Pure transitions for the optional companion story.
var CompanionModel = (function () {
  'use strict';
  var ENCOUNTER_DELAY = 3 * 60 * 1000;
  var INTERACTION_DELAY = 2 * 60 * 1000;
  var options = {
    ages: ['19-21', '22-29', '30-35', '36-41'],
    heights: ['short', 'medium', 'tall'],
    bodies: ['slim', 'balanced', 'full', 'athletic'],
    temperaments: ['assertive', 'gentle', 'lively', 'reserved', 'mature'],
    approaches: ['lead', 'equal', 'follow']
  };
  function person(id) { return CompanionRoster.find(function (p) { return p.id === id; }); }
  function finite(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
  function selection(value, allowed) {
    return Array.isArray(value) ? allowed.filter(function (key) { return value.indexOf(key) !== -1; }) : [];
  }
  function preferences(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var p = { gender: ['female', 'male', 'any', 'off'].indexOf(raw.gender) !== -1 ? raw.gender : null };
    Object.keys(options).forEach(function (key) { p[key] = selection(raw[key], options[key]); });
    return p;
  }
  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var s = {
      version: 1, prompted: raw.prompted === true, preferences: preferences(raw.preferences),
      people: {}, pendingId: null, partnerId: null, nextEncounterAt: finite(raw.nextEncounterAt)
    };
    CompanionRoster.forEach(function (p) {
      var r = raw.people && raw.people[p.id];
      if (!r || ['invited', 'known', 'declined'].indexOf(r.status) === -1) return;
      s.people[p.id] = {
        status: r.status, level: r.status === 'known' ? Math.max(1, Math.min(3, finite(r.level))) : 0,
        viewed: r.viewed === true, nextInteractionAt: finite(r.nextInteractionAt),
        visits: Math.min(1000000, finite(r.visits)), homeReady: r.homeReady === true
      };
    });
    if (person(raw.partnerId) && s.people[raw.partnerId] && s.people[raw.partnerId].status === 'known' && s.people[raw.partnerId].level >= 3) s.partnerId = raw.partnerId;
    if (person(raw.pendingId) && s.people[raw.pendingId] && s.people[raw.pendingId].status === 'invited') s.pendingId = raw.pendingId;
    return s;
  }
  function matches(p, pref) {
    pref = preferences(pref);
    if (!p || pref.gender === null || pref.gender === 'off') return false;
    if (pref.gender !== 'any' && pref.gender !== p.gender) return false;
    return !pref.ages.length || pref.ages.some(function (range) {
      var bounds = range.split('-').map(Number);
      return p.age >= bounds[0] && p.age <= bounds[1];
    });
  }
  function weight(p, pref) {
    var total = 1;
    if (pref.heights.indexOf(p.heightKind) !== -1) total += 3;
    if (pref.bodies.indexOf(p.bodyKind) !== -1) total += 3;
    if (pref.temperaments.some(function (x) { return p.temperaments.indexOf(x) !== -1; })) total += 4;
    if (pref.approaches.indexOf(p.approach) !== -1) total += 3;
    return total;
  }
  function candidates(raw) {
    var s = normalize(raw);
    if (s.partnerId) return [];
    return CompanionRoster.filter(function (p) {
      return matches(p, s.preferences) && (!s.people[p.id] || s.people[p.id].status === 'invited');
    });
  }
  function choose(raw, random) {
    var s = normalize(raw);
    if (s.partnerId) return null;
    if (s.pendingId && matches(person(s.pendingId), s.preferences)) return person(s.pendingId);
    var pool = candidates(s);
    var sum = pool.reduce(function (n, p) { return n + weight(p, s.preferences); }, 0);
    if (!sum) return null;
    var draw = Math.max(0, Math.min(0.999999999, (random || Math.random)())) * sum;
    for (var i = 0; i < pool.length; i++) { draw -= weight(pool[i], s.preferences); if (draw < 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  function setPreferences(raw, pref, now) {
    var s = normalize(raw);
    s.preferences = preferences(pref);
    if (s.preferences.gender === null) throw new Error('请选择想认识谁，或暂时不考虑。');
    s.prompted = true;
    if (s.pendingId && !matches(person(s.pendingId), s.preferences)) {
      delete s.people[s.pendingId];
      s.pendingId = null;
    }
    s.nextEncounterAt = now + 30 * 1000;
    return s;
  }
  function invite(raw, id, now) {
    var s = normalize(raw), p = person(id);
    if (s.partnerId || !matches(p, s.preferences) || (s.pendingId && s.pendingId !== id) || (s.people[id] && s.people[id].status !== 'invited')) throw new Error('这次邀约已失效，请重新选择。');
    s.people[id] = s.people[id] || { status: 'invited', level: 0, viewed: false, visits: 0, homeReady: false, nextInteractionAt: 0 };
    s.pendingId = id;
    s.nextEncounterAt = now + ENCOUNTER_DELAY;
    return s;
  }
  function view(raw, id) {
    var s = normalize(raw);
    if (s.people[id]) s.people[id].viewed = true;
    return s;
  }
  function accept(raw, id, now) {
    var s = normalize(raw);
    if (s.partnerId || s.pendingId !== id || !s.people[id] || s.people[id].status !== 'invited' || !matches(person(id), s.preferences)) throw new Error('这次邀约已失效，请重新选择。');
    s.people[id].status = 'known'; s.people[id].level = 1;
    s.people[id].nextInteractionAt = now + INTERACTION_DELAY;
    s.pendingId = null; s.nextEncounterAt = now + ENCOUNTER_DELAY;
    return s;
  }
  function decline(raw, id, now) {
    var s = normalize(raw);
    if (s.pendingId !== id || !s.people[id] || s.people[id].status !== 'invited') throw new Error('这次邀约已结束。');
    s.people[id].status = 'declined'; s.pendingId = null;
    s.nextEncounterAt = now + ENCOUNTER_DELAY;
    return s;
  }
  function defer(raw, now) {
    var s = normalize(raw); s.nextEncounterAt = now + ENCOUNTER_DELAY; return s;
  }
  function canInteract(raw, id, now) {
    var s = normalize(raw), r = s.people[id];
    return !!(r && r.status === 'known' && (!s.partnerId || s.partnerId === id) && now >= r.nextInteractionAt);
  }
  function interact(raw, id, now) {
    var s = normalize(raw);
    if (!canInteract(s, id, now)) throw new Error('先忙一会儿各自的事，稍后再来相处。');
    var r = s.people[id], episode = Math.max(0, r.level - 1);
    r.level = Math.min(3, r.level + 1); r.visits += 1;
    r.nextInteractionAt = now + INTERACTION_DELAY;
    s.nextEncounterAt = Math.max(s.nextEncounterAt, now + ENCOUNTER_DELAY);
    return { state: s, episode: episode, visit: r.visits, partner: s.partnerId === id };
  }
  function commitPartner(raw, id, now) {
    var s = normalize(raw), r = s.people[id];
    if (s.partnerId || !r || r.status !== 'known' || r.level < 3) throw new Error('先多了解彼此，再认真确定关系。');
    s.partnerId = id;
    if (s.pendingId) { delete s.people[s.pendingId]; s.pendingId = null; }
    s.nextEncounterAt = now + ENCOUNTER_DELAY;
    return s;
  }
  function prepareHome(raw, id) {
    var s = normalize(raw);
    if (s.partnerId !== id) throw new Error('先确定伴侣，再一起布置小屋。');
    s.people[id].homeReady = true; return s;
  }
  function unlocked(game) {
    return !!(game && game.game && game.game.buildings && game.game.buildings.hut >= 1 && game.game.population >= 1 && game.game.builder && game.game.builder.level >= 4);
  }
  return Object.freeze({
    ENCOUNTER_DELAY: ENCOUNTER_DELAY, INTERACTION_DELAY: INTERACTION_DELAY, options: options,
    person: person, preferences: preferences, normalize: normalize, matches: matches, weight: weight,
    candidates: candidates, choose: choose, setPreferences: setPreferences, invite: invite,
    view: view, accept: accept, decline: decline, defer: defer, canInteract: canInteract,
    interact: interact, commitPartner: commitPartner, prepareHome: prepareHome, unlocked: unlocked
  });
}());
