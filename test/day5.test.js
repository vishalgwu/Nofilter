import test from 'node:test';
import assert from 'node:assert/strict';
import { joinRoasts, analyze } from '../server/laugh.js';
import { isAuthorized, accessCookie, codeMatches, parseCookies, RateLimiter } from '../server/guard.js';
import { isStock, dropStock, selectSelf } from '../server/humor.js';

// ---- made-up log rows (these test the maths only; they are not real results) ----
const T = '2026-11-22T10:00:00Z';
const roast = (id, o = {}) => ({ ts: T, type: 'roast', id, tester: 'sam', session: 1, momentKind: 'crash', level: 'spicy', mode: 'self',
  moment: `moment ${id}`, roast: `roast ${id}`, roastStartMs: 1000, ...o });
const laugh = (id, laughScore) => ({ ts: T, type: 'laugh', id, laughScore });

test('joinRoasts attaches the latest rating to each roast', () => {
  const j = joinRoasts([roast('a'), laugh('a', 1), laugh('a', 3), roast('b')]);
  assert.equal(j.find((r) => r.id === 'a').score, 3); // re-rated: latest wins
  assert.equal(j.find((r) => r.id === 'b').score, null); // never rated
});

test('joinRoasts ignores untagged rows by default, and bad or orphan ratings', () => {
  const rows = [roast('a', { tester: undefined }), roast('b'), laugh('b', 7), laugh('zzz', 2)];
  assert.deepEqual(joinRoasts(rows).map((r) => r.id), ['b']);
  assert.equal(joinRoasts(rows)[0].score, null); // 7 is not a valid score
  assert.deepEqual(joinRoasts(rows, { testOnly: false }).map((r) => r.id), ['a', 'b']);
});

test('joinRoasts can ignore rows older than a date', () => {
  const rows = [roast('old', { ts: '2026-11-20T10:00:00Z' }), roast('new')];
  assert.deepEqual(joinRoasts(rows, { since: Date.parse('2026-11-21T00:00:00Z') }).map((r) => r.id), ['new']);
});

test('analyze computes the average, the spread and the weakest type', () => {
  const rows = [
    roast('c1', { momentKind: 'crash' }), laugh('c1', 3),
    roast('c2', { momentKind: 'crash' }), laugh('c2', 2),
    roast('c3', { momentKind: 'crash' }), laugh('c3', 3),
    roast('p1', { momentKind: 'panic' }), laugh('p1', 0),
    roast('p2', { momentKind: 'panic' }), laugh('p2', 1),
    roast('p3', { momentKind: 'panic' }), laugh('p3', 1),
    roast('u1', { momentKind: 'panic' }), // unrated
  ];
  const a = analyze(rows);
  assert.equal(a.roasts, 7);
  assert.equal(a.rated, 6);
  assert.equal(a.unrated, 1);
  assert.equal(a.average, 1.67); // (3+2+3+0+1+1)/6
  assert.equal(a.pctAtLeast2, 50);
  assert.deepEqual(a.dist, { 0: 1, 1: 2, 2: 1, 3: 2 });
  assert.equal(a.byType[0].key, 'panic'); // weakest first
  assert.equal(a.weakest.key, 'panic');
  assert.equal(a.weakest.worst[0].score, 0);
  assert.equal(a.weakest.best[0].score, 1);
});

test('analyze only names a weakest type when it has at least 3 ratings', () => {
  const rows = [roast('a', { momentKind: 'silence' }), laugh('a', 0), roast('b', { momentKind: 'silence' }), laugh('b', 0)];
  assert.equal(analyze(rows).weakest, null);
});

test('the Stage 1 verdict needs average 2 or more AND 90% of roasts under 3 s', () => {
  const good = [];
  for (let i = 0; i < 10; i++) good.push(roast(`g${i}`, { roastStartMs: 1200 }), laugh(`g${i}`, 2));
  const a = analyze(good);
  assert.deepEqual(a.verdict, { laughOk: true, speedOk: true });

  const slow = good.map((r) => (r.type === 'roast' && r.id === 'g0' ? { ...r, roastStartMs: 3500 } : r));
  slow.push(roast('s1', { roastStartMs: 4000 }), laugh('s1', 2)); // 2 of 11 slow
  assert.equal(analyze(slow).verdict.speedOk, false);

  const dull = [roast('d1'), laugh('d1', 1), roast('d2'), laugh('d2', 2)];
  assert.equal(analyze(dull).verdict.laughOk, false); // 1.5
});

test('analyze counts testers and sessions, and lists winners', () => {
  const rows = [
    roast('a', { tester: 'sam', session: 1 }), laugh('a', 3),
    roast('b', { tester: 'sam', session: 2 }), laugh('b', 2),
    roast('c', { tester: 'alex', session: 1 }), laugh('c', 3),
  ];
  const a = analyze(rows);
  assert.equal(a.testers, 2);
  assert.equal(a.sessions, 3);
  assert.deepEqual(a.winners.map((r) => r.id), ['a', 'c']);
  assert.equal(a.byTester.find((t) => t.key === 'sam').sessions, 2);
});

test('analyze copes with an empty log', () => {
  const a = analyze([]);
  assert.equal(a.roasts, 0);
  assert.equal(a.average, null);
  assert.equal(a.verdict.laughOk, false);
});

// ---- access code and rate limiting ----
test('with no access code everyone is allowed', () => {
  assert.equal(isAuthorized('', undefined), true);
  assert.equal(isAuthorized('', 'whatever=1'), true);
});

test('with an access code only the matching cookie is allowed', () => {
  assert.equal(isAuthorized('s3cret', undefined), false);
  assert.equal(isAuthorized('s3cret', 'rc_access=wrong'), false);
  assert.equal(isAuthorized('s3cret', 'a=1; rc_access=s3cret; b=2'), true);
  assert.equal(isAuthorized('s3cret', 'rc_access=s3cre'), false); // different length
});

test('the access cookie is HttpOnly, and Secure when the page is on https', () => {
  assert.match(accessCookie('x y', false), /^rc_access=x%20y; HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(accessCookie('x', false), /Secure/);
  assert.match(accessCookie('x', true), /Secure/);
  assert.equal(parseCookies(accessCookie('x y', false)).rc_access, 'x y');
});

test('codeMatches needs a code to be set and an exact match', () => {
  assert.equal(codeMatches('abc', 'abc'), true);
  assert.equal(codeMatches('abc', 'abd'), false);
  assert.equal(codeMatches('', ''), false); // no code configured: never matches
  assert.equal(codeMatches('abc', null), false);
});

test('the rate limiter allows N hits per window, then recovers', () => {
  const rl = new RateLimiter(3, 1000);
  assert.deepEqual([0, 100, 200, 300].map((t) => rl.hit('ip', t)), [true, true, true, false]);
  assert.equal(rl.hit('other-ip', 300), true); // keys are independent
  assert.equal(rl.hit('ip', 1100), true); // the first hit has aged out
});

// ---- stock phrases ----
test('stock phrases are recognised', () => {
  for (const s of ['Official ceremony: car meets ocean.', 'The ghost filed a noise complaint.', 'Pure masterclass in panic.',
    'The NPCs are worried.', 'A career in swimming awaits.']) assert.equal(isStock(s), true, s);
  for (const s of ['Parking like a raccoon with a license.', 'Third ocean dive, car is a boat now.']) assert.equal(isStock(s), false, s);
});

test('dropStock keeps fresh roasts but never leaves nothing', () => {
  assert.deepEqual(dropStock(['Official ceremony vibes.', 'Fresh joke here.']), ['Fresh joke here.']);
  assert.deepEqual(dropStock(['Official ceremony vibes.']), ['Official ceremony vibes.']);
});

test('self-pick skips a stock-phrase roast even if the writer chose it', () => {
  const raw = JSON.stringify({ roasts: ['The NPCs filed a complaint.', 'Ocean fan club president.', 'Wet again, bold move.'], best: 1 });
  const r = selectSelf(raw);
  assert.ok(!r.candidates.some(isStock));
  assert.equal(r.pickedBy, 'rule'); // its pick was removed, so the shortest fresh one wins
});
