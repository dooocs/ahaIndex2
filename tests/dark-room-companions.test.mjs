import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function model() {
  const context = vm.createContext({});
  for (const script of ['companions-data', 'companions-core']) {
    vm.runInContext(readFileSync(new URL(`../public/dark-room/script/${script}.js`, import.meta.url), 'utf8'), context);
  }
  return { M: context.CompanionModel, roster: context.CompanionRoster };
}
const { M, roster } = model();
const plain = value => JSON.parse(JSON.stringify(value));
const configured = (pref = { gender: 'any' }) => M.setPreferences(null, pref, 0);
const invited = (id, pref) => M.invite(configured(pref), id, 100000);

test('roster covers both genders, adult age groups and independent appearance/personality combinations', () => {
  assert.equal(roster.length, 22);
  assert.equal(new Set(roster.map(p => p.id)).size, 22);
  assert(roster.every(p => p.age >= 19 && p.age <= 41 && p.appearance && p.familiar && p.episode && p.goal));
  assert(roster.some(p => p.gender === 'male' && p.age === 19));
  assert(roster.some(p => p.gender === 'female' && p.age === 19));
  assert(roster.some(p => p.age === 21));
  assert(roster.some(p => p.age === 35));
  assert(roster.some(p => p.age === 41));
  assert(roster.some(p => p.gender === 'male' && p.height >= 185 && p.approach === 'follow'));
  assert(roster.some(p => p.gender === 'female' && p.age <= 21 && p.approach === 'lead'));
});

test('old saves default to unknown preferences and never infer a gender', () => {
  const s = M.normalize(undefined);
  assert.equal(s.preferences.gender, null);
  assert.equal(s.partnerId, null);
  assert.equal(M.choose(s), null);
  assert.equal(M.candidates(s).length, 0);
  assert.equal(M.unlocked({ game: { buildings: { hut: 1 }, population: 4, builder: { level: 4 } } }), true);
  assert.equal(M.unlocked({ game: { buildings: {}, population: 0, builder: { level: 1 } } }), false);
});

test('gender and age are hard filters while physical and personality choices are soft preferences', () => {
  const s = configured({ gender: 'female', ages: ['36-41'], bodies: ['athletic'] });
  const pool = M.candidates(s);
  assert.equal(pool.length, 3, 'a missing soft preference must not relax the hard age/gender boundaries');
  assert(pool.every(p => p.gender === 'female' && p.age >= 36 && p.age <= 41));
  for (const r of [0, .1, .5, .9, .999999]) assert(pool.some(p => p.id === M.choose(s, () => r).id));
  const multiple = M.candidates(configured({ gender: 'male', ages: ['19-21', '36-41'] }));
  assert(multiple.some(p => p.age === 19) && multiple.some(p => p.age === 39));
  assert(multiple.every(p => p.age !== 35));
});

test('opt-out and unset preferences yield no invitations', () => {
  assert.equal(M.choose(configured({ gender: 'off' })), null);
  assert.throws(() => M.setPreferences(null, {}, 0), /请选择/);
});

test('soft preferences increase candidate weight without discarding diverse matches', () => {
  const pref = M.preferences({ gender: 'female', ages: ['36-41'], temperaments: ['assertive'], heights: ['tall'] });
  assert(M.weight(M.person('shenfei'), pref) > M.weight(M.person('tangwan'), pref));
  assert.equal(M.candidates(configured(pref)).length, 3);
});

test('viewing a profile and declining affect only that person, not declared preferences', () => {
  const s = invited('shenfei', { gender: 'female', ages: ['36-41'] });
  const pref = plain(s.preferences);
  const viewed = M.view(s, 'shenfei');
  assert.equal(viewed.people.shenfei.viewed, true);
  assert.equal(s.people.shenfei.viewed, false, 'pure transition must not mutate an old snapshot');
  assert.deepEqual(plain(viewed.preferences), pref);
  const declined = M.decline(viewed, 'shenfei', 200000);
  assert.deepEqual(plain(declined.preferences), pref);
  assert(!M.candidates(declined).some(p => p.id === 'shenfei'));
  assert(M.candidates(declined).every(p => p.gender === 'female'));
});

test('pending identity survives serialization, closing and a reload', () => {
  const s = M.defer(invited('luchuan'), 200000);
  const reloaded = M.normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(M.choose(reloaded, () => .99).id, 'luchuan');
  assert.equal(reloaded.nextEncounterAt, 200000 + M.ENCOUNTER_DELAY);
  assert.throws(() => M.invite(reloaded, 'chuqing', 300000), /失效/);
});

test('changing explicit preferences clears an incompatible pending invitation', () => {
  const s = M.setPreferences(invited('luchuan'), { gender: 'female', ages: ['36-41'] }, 200000);
  assert.equal(s.pendingId, null);
  assert.equal(s.people.luchuan, undefined);
  assert.equal(M.choose(s, () => 0).gender, 'female');
  assert.throws(() => M.invite(s, 'luchuan', 300000), /失效/);
});

test('acceptance starts acquaintance, with repeated interaction gated by saved cooldowns', () => {
  let s = M.accept(invited('shenfei'), 'shenfei', 200000);
  assert.equal(s.people.shenfei.level, 1);
  assert.equal(s.partnerId, null);
  assert.equal(M.canInteract(s, 'shenfei', 200000), false);
  assert.throws(() => M.accept(s, 'shenfei', 200001), /失效/);
  assert.throws(() => M.interact(s, 'shenfei', 200001), /稍后/);
  assert.throws(() => M.commitPartner(s, 'shenfei', 200001), /多了解/);
  let result = M.interact(s, 'shenfei', 200000 + M.INTERACTION_DELAY);
  assert.equal(result.episode, 0); s = result.state;
  assert.equal(s.people.shenfei.level, 2);
  result = M.interact(M.normalize(plain(s)), 'shenfei', 200000 + 2 * M.INTERACTION_DELAY);
  assert.equal(result.episode, 1);
  assert.equal(result.state.people.shenfei.level, 3);
  assert.equal(result.state.partnerId, null, 'relationship requires a separate explicit confirmation');
});

test('one explicit partner stops new invitations and permits saved household progress', () => {
  let s = M.accept(invited('shenfei'), 'shenfei', 0);
  s = M.interact(s, 'shenfei', M.INTERACTION_DELAY).state;
  s = M.interact(s, 'shenfei', 2 * M.INTERACTION_DELAY).state;
  s = M.commitPartner(s, 'shenfei', 2 * M.INTERACTION_DELAY);
  assert.equal(M.choose(s), null);
  assert.equal(M.candidates(s).length, 0);
  assert.throws(() => M.invite(s, 'tangwan', 900000), /失效/);
  assert.throws(() => M.commitPartner(s, 'tangwan', 900000), /多了解/);
  const home = M.prepareHome(s, 'shenfei');
  assert.equal(M.normalize(plain(home)).people.shenfei.homeReady, true);
  assert.equal(s.people.shenfei.homeReady, false);
  assert.equal(M.interact(home, 'shenfei', 3 * M.INTERACTION_DELAY).partner, true);
});

test('malformed imported companion fields are normalized without altering other game state', () => {
  const s = M.normalize({ preferences: { gender: 'guess', ages: ['0-18', '36-41'], temperaments: ['assertive', 'assertive', '<script>'] }, people: { unknown: { status: 'known' }, shenfei: { status: 'known', level: Infinity, nextInteractionAt: NaN } }, partnerId: 'unknown', pendingId: '<script>' });
  assert.equal(s.preferences.gender, null);
  assert.deepEqual(plain(s.preferences.ages), ['36-41']);
  assert.deepEqual(plain(s.preferences.temperaments), ['assertive']);
  assert.equal(s.partnerId, null);
  assert.equal(s.pendingId, null);
  assert.equal(s.people.unknown, undefined);
  assert.equal(s.people.shenfei.nextInteractionAt, 0);
});
