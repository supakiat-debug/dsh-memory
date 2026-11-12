/* Smoke test for dsh-memory with a mock Cordis context.
   Run: node --import ./test-register.mjs test-smoke.mjs */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { Config, apply } from './index.js';

const SESSIONS = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'sessions');
/** Opt-in: reading real session logs is the developer's own data, never a test default. */
const REAL_HISTORY = process.env.DSH_MEMORY_TEST_HISTORY === '1' && fs.existsSync(SESSIONS);

/**
 * A synthetic sessions root holding one zstd-compressed log, so the history tool
 * is covered without touching anybody's real conversations.
 * @returns {string} a directory to use as `sessionsRoot`.
 */
function fakeSessionsRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshmem-sessions-'));
  const dir = path.join(root, '--C--fake-workspace--', 'session-old');
  fs.mkdirSync(dir, { recursive: true });
  const events = [
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'ชอบกาแฟไม่ใส่น้ำตาล' }] } },
    { type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'injected reminder' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '<system-reminder>wrapped note</system-reminder>' }] } },
    { type: 'assistant/message', data: { content: [{ type: 'text', text: 'assistant noise' }] } },
  ];
  const jsonl = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(jsonl, 'utf8')));
  return root;
}

const FAKE_SESSIONS = fakeSessionsRoot();
const A = { agent: { session: { id: 'session-A' } } };
const B = { agent: { session: { id: 'session-B' } } };

/**
 * Build one isolated plugin instance with a mock Cordis context.
 * @param {Record<string, any>} overrides - config overrides for this run.
 * @returns {{ tools: any, sections: any[], contexts: any[], dir: string,
 *   head: (ctx?: any) => string, snap: (ctx?: any) => string, seed: (t: string, s: string) => void }} harness.
 */
function harness(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshmem-'));
  const tools = {};
  const sections = [];
  const contexts = [];
  const ctx = {
    tools: { register: (d) => { tools[d.name] = d; } },
    systemPrompt: {
      section: (s) => { sections.push(s); return () => {}; },
      context: (c) => { contexts.push(c); return () => {}; },
    },
    effect: (fn) => fn(),
  };
  apply(ctx, (Config.parse ?? Config)({ memoryDir: dir, sessionsRoot: FAKE_SESSIONS, ...overrides }));
  return {
    dir,
    tools,
    sections,
    contexts,
    head: (s = A) => sections[0]?.text(s) ?? '',
    snap: (s = A) => contexts[0]?.text(s) ?? '',
    seed: (target, text) => fs.writeFileSync(path.join(dir, target === 'user' ? 'USER.md' : 'MEMORY.md'), text, 'utf8'),
  };
}

// ---- baseline: nothing injected when both stores are empty ----
const empty = harness();
assert.equal(empty.sections.length, 1, 'hybrid registers the frozen head');
assert.equal(empty.contexts.length, 1, 'hybrid registers the delta snapshot');
assert.equal(empty.sections[0].name, 'memory:profile');
assert.equal(empty.contexts[0].name, 'memory:update');
assert.equal(empty.sections[0].order, 150, 'head keeps the original prompt-section slot');
assert.equal(empty.contexts[0].order, 130, 'snapshot lands after sandbox/approval/subagent contexts');
assert.equal(empty.sections[0].interpolate, false, 'learned text is never a prompt template');
assert.equal(empty.head(), '', 'empty profile yields an empty head');
assert.equal(empty.snap(), '', 'an untouched session contributes no snapshot');

// ---- hybrid: frozen head + append-only delta ----
const h = harness();
h.seed('user', '# USER.md\n- ชอบคำตอบกระชับ\n- สื่อสารภาษาไทยเป็นหลัก\n');
h.seed('memory', '- เครื่อง Windows 11, workspace C:\\Users\\Supk\n');
const head0 = h.head();
assert.ok(head0.includes('USER PROFILE') && head0.includes('AGENT NOTES'), 'head has both stores');
assert.ok(head0.includes('FROZEN'), 'head says it is session-frozen');
assert.equal(h.snap(), '', 'no edits yet, so no snapshot');

const mem = h.tools.memory.execute;
await mem({ target: 'user', action: 'add', content: 'ไม่ใช้ตาราง markdown ในแชต' });
assert.equal(h.head(), head0, 'head stays byte-identical after a write (prefix cache survives)');
let snap = h.snap();
assert.ok(snap.includes('MEMORY UPDATE'), 'snapshot framing present');
assert.ok(snap.includes('added this session') && snap.includes('ไม่ใช้ตาราง'), 'added line is in the snapshot');
assert.ok((await mem({ target: 'user', action: 'add', content: 'x' })).text.includes('MEMORY UPDATE'), 'write result explains delivery');

await mem({ target: 'user', action: 'patch', old_text: 'กระชับ', content: 'สั้น' });
snap = h.snap();
assert.ok(
  snap.includes('- ชอบคำตอบสั้น') && snap.includes('no longer current') && snap.includes('- ชอบคำตอบกระชับ'),
  'patch shows as add + supersede',
);

await mem({ target: 'user', action: 'remove', old_text: 'ภาษาไทย' });
assert.ok(h.snap().includes('- สื่อสารภาษาไทยเป็นหลัก'), 'removal is reported as no longer current');

await mem({ target: 'user', action: 'add', content: 'ใช้ template {{name}} เวลาเขียนบทความ'});
assert.ok(!h.snap().includes('{{'), 'double braces cannot become a prompt variable reference');

// a second session freezes its own baseline and starts with no delta
const headB = h.head(B);
assert.ok(headB.includes('ไม่ใช้ตาราง') && headB.includes('template'), 'a new session sees current entries in its own head');
assert.notEqual(headB, head0, 'per-session baselines differ');
assert.equal(h.snap(B), '', 'the new session has no delta of its own');

// ---- oversized delta degrades to a pointer ----
const big = harness({ deltaCharLimit: 60 });
big.seed('user', '- alpha\n');
big.head();
await big.tools.memory.execute({ target: 'user', action: 'add', content: 'bravo charlie delta echo foxtrot golf hotel' });
assert.ok(big.snap().includes('char snapshot cap'), 'oversized delta points at memory read');

// ---- legacy behaviours still enforced ----
const r = await mem({ target: 'memory', action: 'add', content: 'เครื่อง Windows 11, workspace C:\\Users\\Supk' });
assert.ok(r.text.includes('duplicate'), 'duplicate detected');
let threw = false;
try { await mem({ target: 'user', action: 'rewrite', content: 'x'.repeat(2000) }); } catch { threw = true; }
assert.ok(threw, 'character limit enforced');

// ---- other delivery modes ----
const live = harness({ injectMode: 'section' });
assert.equal(live.sections.length, 1);
assert.equal(live.contexts.length, 0, 'section mode registers no snapshot');
assert.equal(live.sections[0].interpolate, true, 'legacy mode keeps interpolation on');
assert.equal(live.head(), '', 'legacy head is empty with no profile');
live.seed('user', '- ของชอบ: กาแฟดริป\n');
assert.ok(live.head().includes('กาแฟดริป') && !live.head().includes('FROZEN'), 'section mode text is live and unannotated');
live.seed('user', '- ของชอบ: มัทฉะ\n');
assert.ok(live.head().includes('มัทฉะ'), 'section mode reflects edits immediately');
assert.ok((await live.tools.memory.execute({ target: 'user', action: 'add', content: 'y' })).text.includes('prefix cache'), 'section mode warns about the cache');

const snapOnly = harness({ injectMode: 'context' });
assert.equal(snapOnly.sections.length, 0, 'context mode registers no head text');
snapOnly.seed('memory', '- โน้ตสำคัญ\n');
assert.ok(snapOnly.snap().includes('AGENT NOTES') && snapOnly.snap().includes('โน้ตสำคัญ'), 'context mode carries the live profile');

const off = harness({ injectMode: 'off' });
assert.equal(off.sections.length + off.contexts.length, 0, 'off injects nothing');
const legacy = harness({ injectProfile: false });
assert.equal(legacy.sections.length + legacy.contexts.length, 0, 'injectProfile: false still means off');

let badMode = false;
try { harness({ injectMode: 'nope' }); } catch (e) { badMode = /injectMode/.test(e.message); }
assert.ok(badMode, 'unknown injectMode fails loudly');

// ---- history import (synthetic log; real logs only with DSH_MEMORY_TEST_HISTORY=1) ----
const hist = await h.tools.memory_history.execute({ sessions: 5, maxChars: 3000 });
assert.ok(hist.text.startsWith('Scanned'), 'history header');
assert.ok(hist.text.includes('ชอบกาแฟไม่ใส่น้ำตาล'), 'user turns are imported');
assert.ok(!hist.text.includes('injected reminder'), 'non-user sources are skipped');
assert.ok(!hist.text.includes('wrapped note'), 'angle-bracket injections are skipped');
assert.ok(!hist.text.includes('assistant noise'), 'assistant replies are off by default');
assert.ok((await h.tools.memory_history.execute({ sessions: 5, includeAssistant: true })).text.includes('assistant noise'), 'includeAssistant opts them in');
assert.ok((await h.tools.memory_history.execute({ sessions: 5 }, { agent: { session: { id: 'session-old' } } })).text.includes('Current session excluded'), 'the current session is skipped');
assert.ok((await h.tools.memory_history.execute({ workspace: 'no-such-workspace' })).text.includes('Scanned 0'), 'workspace filter works');
if (REAL_HISTORY) {
  const real = await harness({ sessionsRoot: SESSIONS }).tools.memory_history.execute({ sessions: 3, maxChars: 2000 });
  console.log('--- real history head ---\n' + real.text.slice(0, 200));
}

console.log('--- frozen head (hybrid) ---\n' + head0.slice(0, 320));
console.log('\n--- delta snapshot (hybrid) ---\n' + h.snap().slice(0, 520));
console.log('\nALL SMOKE TESTS PASSED');
