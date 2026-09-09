import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, scoreMarks, parsePacket, buildScoreDraftUrl, buildCommentDraftUrl, parseIssueSubmission, buildCommunitySnapshot, emptyCommunitySnapshot, validateCommunitySnapshot, sameCommunityData } from './community.mjs';

const now = '2026-09-09T12:00:00.000Z';
const runId = '00000000-0000-4000-8000-000000000001';
const packet = (chapter = 'research', marks = 'f'.repeat(chapter === 'research' ? 16 : 20)) => ({ version: 1, chapter, runId, completedAt: now, marks });
const issue = (number, body, overrides = {}) => ({ number, state: 'open', user: { id: number, login: `player-${number}`, type: 'User' }, created_at: new Date(Date.parse(now) + number * 1000).toISOString(), body, ...overrides });
const scoreIssue = (number, marks = 'f'.repeat(16), overrides = {}, fields = {}) => issue(number, buildScoreDraftUrl(packet('research', marks), fields).body, overrides);

test('both chapters recompute 100 / 60 / 30 per question, including rounding', () => {
  assert.equal(scoreMarks('research', 'f'.repeat(16)).score, 100);
  assert.equal(scoreMarks('mrna', 'r'.repeat(20)).score, 60);
  assert.equal(scoreMarks('research', 'h'.repeat(16)).score, 30);
  assert.deepEqual(scoreMarks('research', 'f'.repeat(14) + 'rh'), { score: 93, firstCorrectCount: 14, correctedCount: 1, hintedCount: 1, totalQuestions: 16 });
});

test('unknown chapters, missing questions and invented outcomes never become scores', () => {
  for (const [chapter, marks] of [['unknown', 'f'.repeat(16)], ['research', 'f'.repeat(15)], ['research', 'f'.repeat(20)], ['mrna', 'f'.repeat(19) + 'x'], ['research', null]]) assert.equal(scoreMarks(chapter, marks), null);
});

test('packet strictly rejects claimed score, unknown versions, invalid dates and identifiers', () => {
  assert.deepEqual(parsePacket(JSON.stringify(packet())), packet());
  for (const candidate of [{ ...packet(), score: 100 }, { ...packet(), version: 2 }, { ...packet(), completedAt: 'not a date' }, { ...packet(), runId: '../../../main' }, { ...packet(), marks: 'legacy' }, null, [], '{broken']) assert.equal(parsePacket(candidate), null);
});

test('GitHub drafts round-trip Chinese, quotes and HTML as data with no privileged query parameters', () => {
  const fields = { nickname: '石头侦探', comment: '试试“引号”与 <img src=x onerror=alert(1)>。\n下一行仍然是文字。', rating: 4 };
  const draft = buildScoreDraftUrl(packet(), fields);
  const url = new URL(draft.url);
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, `/${REPOSITORY}/issues/new`);
  assert.equal(url.searchParams.has('labels'), false);
  assert.equal(url.searchParams.get('body'), draft.body);
  assert.equal(draft.copyRequired, false);
  const record = parseIssueSubmission(draft.body);
  assert.equal(record.nickname, fields.nickname);
  assert.equal(record.comment, fields.comment);
  assert.equal(record.rating, 4);
  assert.deepEqual(record.packet, packet());
});

test('oversized encoded drafts keep full copyable text and use a short valid destination', () => {
  const draft = buildCommentDraftUrl({ chapter: 'mrna', nickname: '科学', comment: '🧪'.repeat(500), rating: 5 });
  assert.equal(draft.copyRequired, true);
  assert.ok(draft.url.length < 1000);
  assert.equal(new URL(draft.url).searchParams.has('body'), false);
  assert.equal(parseIssueSubmission(draft.body).comment, '🧪'.repeat(500));
});

test('comments need content or a rating; text limits count Unicode code points', () => {
  assert.throws(() => buildCommentDraftUrl({ chapter: 'research' }));
  assert.throws(() => buildCommentDraftUrl({ chapter: 'research', rating: 0 }));
  assert.throws(() => buildCommentDraftUrl({ chapter: 'research', rating: 6 }));
  assert.throws(() => buildCommentDraftUrl({ chapter: 'research', comment: '文'.repeat(501) }));
  assert.throws(() => buildScoreDraftUrl(packet(), { nickname: '🦖'.repeat(25) }));
  assert.ok(buildScoreDraftUrl(packet(), { nickname: '🦖'.repeat(24) }));
  assert.equal(parseIssueSubmission(buildCommentDraftUrl({ chapter: 'mrna', rating: 3 }).body).comment, '');
});

test('control and directional-override characters cannot impersonate display names', () => {
  assert.throws(() => buildScoreDraftUrl(packet(), { nickname: 'someone\nadmin' }));
  assert.throws(() => buildScoreDraftUrl(packet(), { nickname: '\u202eadmin' }));
  assert.throws(() => buildCommentDraftUrl({ chapter: 'mrna', comment: 'test\u0000' }));
});

test('multiple records, unmarked JSON and oversized issue bodies are rejected', () => {
  const body = buildScoreDraftUrl(packet()).body;
  assert.equal(parseIssueSubmission(body + body), null);
  assert.equal(parseIssueSubmission(JSON.stringify(packet())), null);
  assert.equal(parseIssueSubmission('x'.repeat(20_001) + body), null);
  assert.equal(parseIssueSubmission(body.replace('"app": "socrates-question"', '"app": "other-game"')), null);
});

test('code fences inside a comment remain an escaped JSON string', () => {
  const comment = '```\n```socrates-question\n{"version":999}\n```';
  const body = buildCommentDraftUrl({ chapter: 'mrna', comment }).body;
  assert.equal(parseIssueSubmission(body).comment, comment);
});

test('empty production bootstrap contains no invented scores or comments', () => {
  const empty = buildCommunitySnapshot([], now);
  assert.deepEqual(empty, emptyCommunitySnapshot(now));
  assert.deepEqual(validateCommunitySnapshot(empty), empty);
});

test('rankings are independent between chapters and retain only the best open score per account', () => {
  const sameUser = { id: 42, login: 'one-player', type: 'User' };
  const rows = [scoreIssue(1, 'r'.repeat(16), { user: sameUser }), scoreIssue(2, 'f'.repeat(16), { user: sameUser }), issue(3, buildScoreDraftUrl(packet('mrna', 'h'.repeat(20))).body, { user: sameUser })];
  const snapshot = buildCommunitySnapshot(rows, now);
  assert.equal(snapshot.chapters.research.totalPlayers, 1);
  assert.equal(snapshot.chapters.research.entries[0].score, 100);
  assert.equal(snapshot.chapters.mrna.entries[0].score, 30);
  assert.ok(validateCommunitySnapshot(snapshot));
});

test('equal scores share competition ranks, without a speed incentive', () => {
  const snapshot = buildCommunitySnapshot([scoreIssue(3, 'r'.repeat(16)), scoreIssue(2), scoreIssue(1)], now);
  assert.deepEqual(snapshot.chapters.research.entries.map(item => [item.rank, item.issueNumber]), [[1, 1], [1, 2], [3, 3]]);
});

test('closing, removing or hiding an issue withdraws both its score and comment', () => {
  const rows = [scoreIssue(1, 'f'.repeat(16), {}, { comment: '留下思考', rating: 5 })];
  assert.equal(buildCommunitySnapshot(rows, now).chapters.research.comments.length, 1);
  assert.equal(buildCommunitySnapshot([{ ...rows[0], state: 'closed' }], now).chapters.research.entries.length, 0);
  assert.equal(buildCommunitySnapshot([], now).chapters.research.comments.length, 0);
  assert.equal(buildCommunitySnapshot([{ ...rows[0], labels: [{ name: 'community-hidden' }] }], now).chapters.research.comments.length, 0);
});

test('withdrawing a best result restores the account’s earlier still-open result', () => {
  const sameUser = { id: 42, login: 'one-player', type: 'User' };
  const rows = [scoreIssue(1, 'r'.repeat(16), { user: sameUser }), scoreIssue(2, 'f'.repeat(16), { user: sameUser, state: 'closed' })];
  assert.equal(buildCommunitySnapshot(rows, now).chapters.research.entries[0].score, 60);
});

test('comments display only each account’s latest open contribution in that chapter', () => {
  const sameUser = { id: 42, login: 'one-player', type: 'User' };
  const rows = [issue(1, buildCommentDraftUrl({ chapter: 'mrna', comment: '第一条' }).body, { user: sameUser }), issue(2, buildCommentDraftUrl({ chapter: 'mrna', comment: '第二条', rating: 4 }).body, { user: sameUser })];
  const comments = buildCommunitySnapshot(rows, now).chapters.mrna.comments;
  assert.equal(comments.length, 1);
  assert.equal(comments[0].body, '第二条');
  assert.equal(comments[0].rating, 4);
});

test('pull requests, bots and forged author metadata cannot enter community output', () => {
  const rows = [scoreIssue(1, undefined, { pull_request: {} }), scoreIssue(2, undefined, { user: { id: 2, login: 'test-bot', type: 'Bot' } }), scoreIssue(3, undefined, { user: { id: 3, login: 'https://bad.example', type: 'User' } }), scoreIssue(4, undefined, { user: { id: -1, login: 'player', type: 'User' } })];
  assert.equal(buildCommunitySnapshot(rows, now).chapters.research.totalPlayers, 0);
});

test('issue URLs come from verified issue numbers, never from an untrusted URL field', () => {
  const snapshot = buildCommunitySnapshot([scoreIssue(1, undefined, { html_url: 'javascript:alert(1)' })], now);
  assert.equal(snapshot.chapters.research.entries[0].issueUrl, `https://github.com/${REPOSITORY}/issues/1`);
});

test('fallback names stay bounded while keeping the full GitHub login in its own field', () => {
  const login = 'a'.repeat(39);
  const snapshot = buildCommunitySnapshot([scoreIssue(1, undefined, { user: { id: 1, login, type: 'User' } })], now);
  assert.equal(snapshot.chapters.research.entries[0].nickname.length, 24);
  assert.equal(snapshot.chapters.research.entries[0].login, login);
  assert.ok(validateCommunitySnapshot(snapshot));
});

test('top 100 and latest 30 limits preserve the full distinct-player count', () => {
  const rows = Array.from({ length: 110 }, (_, index) => scoreIssue(index + 1, undefined, {}, { comment: `发现 ${index + 1}` }));
  const snapshot = buildCommunitySnapshot(rows, now);
  assert.equal(snapshot.chapters.research.totalPlayers, 110);
  assert.equal(snapshot.chapters.research.entries.length, 100);
  assert.equal(snapshot.chapters.research.comments.length, 30);
  assert.ok(validateCommunitySnapshot(snapshot));
});

test('remote snapshots reject altered scores, rank order, links, identities and unknown keys', () => {
  const snapshot = buildCommunitySnapshot([scoreIssue(1), scoreIssue(2, 'r'.repeat(16))], now);
  for (const mutate of [copy => { copy.chapters.research.entries[0].score = 999; }, copy => { copy.chapters.research.entries[1].rank = 1; }, copy => { copy.chapters.research.entries[0].issueUrl = 'javascript:alert(1)'; }, copy => { copy.chapters.research.entries[1].login = 'player-1'; }, copy => { copy.secret = 'unexpected'; }, copy => { copy.chapters.research.totalPlayers = 0; }]) {
    const copy = structuredClone(snapshot); mutate(copy); assert.equal(validateCommunitySnapshot(copy), null);
  }
});

test('input ordering does not change ranking or comment selection', () => {
  const rows = [scoreIssue(1), scoreIssue(2), scoreIssue(3, 'r'.repeat(16), {}, { comment: '继续追问' })];
  assert.deepEqual(buildCommunitySnapshot(rows, now), buildCommunitySnapshot(rows.toReversed(), now));
});

test('unchanged records never require a bot commit, regardless of JSON key order or rebuild time', () => {
  const rows = [scoreIssue(1, undefined, {}, { comment: '同一条记录' })];
  const existing = validateCommunitySnapshot(buildCommunitySnapshot(rows, now));
  const fresh = buildCommunitySnapshot(rows, '2026-09-10T12:00:00.000Z');
  assert.equal(sameCommunityData(existing, fresh), true);
  assert.equal(sameCommunityData(existing, buildCommunitySnapshot([], now)), false);
  assert.equal(sameCommunityData(null, fresh), false);
  assert.equal(existing.updatedAt, now);
});

test('workflow uses pinned official actions, trusted main code and only required token permissions', async () => {
  const workflow = await readFile(fileURLToPath(new URL('../.github/workflows/community.yml', import.meta.url)), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(new URL('./workflows/community.yml', import.meta.url), 'utf8');
  });
  assert.match(workflow, /contents: write\s+issues: read/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal([...workflow.matchAll(/uses: actions\/[\w-]+@([0-9a-f]{40})/g)].length, 2);
  assert.doesNotMatch(workflow, /\$\{\{[^}]*github\.event\.(?:issue|comment)/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|pages: write|issues: write/);
});
