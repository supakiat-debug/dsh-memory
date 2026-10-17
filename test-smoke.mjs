/* Smoke test for dsh-memory with a mock Cordis context. Run: node test-smoke.mjs */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Config, apply } from './index.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshmem-'));
const tools = {};
const sections = [];
const ctx = {
  tools: { register: (d) => { tools[d.name] = d; } },
  systemPrompt: { section: (s) => { sections.push(s); return () => {}; } },
  effect: (fn) => fn(),
};
const config = (Config.parse ?? Config)({
  memoryDir: tmp,
  sessionsRoot: 'C:/Users/Supk/.dsh/sessions',
});

apply(ctx, config);
assert.ok(tools.memory, 'memory tool registered');
assert.ok(tools.memory_history, 'memory_history tool registered');
assert.equal(sections.length, 1, 'one prompt section');
assert.equal(sections[0].name, 'memory:profile');
assert.equal(sections[0].text({}), '', 'empty profile yields empty section');

const mem = tools.memory.execute;
const out = (r) => r.then ? await0(r) : r;
function await0(p) { return p; }

let r = await mem({ target: 'user', action: 'add', content: 'ชอบคำตอบกระชับ ไม่ใช้ตาราง markdown' });
console.log('add:', r.text.split('\n')[0]);
r = await mem({ target: 'user', action: 'add', content: 'สื่อสารภาษาไทยเป็นหลัก' });
r = await mem({ target: 'user', action: 'read', target: 'user' });
console.log('read:\n' + r.text);
assert.ok(r.text.includes('กระชับ') && r.text.includes('ไทย'));

r = await mem({ target: 'user', action: 'patch', old_text: 'กระชับ', content: 'สั้น' });
r = await mem({ target: 'user', action: 'read' });
assert.ok(r.text.includes('สั้น') && !r.text.includes('กระชับ'), 'patch worked');

r = await mem({ target: 'user', action: 'remove', old_text: 'สั้น' });
r = await mem({ target: 'user', action: 'read' });
assert.ok(!r.text.includes('สั้น'), 'remove worked');

// duplicate add is a no-op
await mem({ target: 'memory', action: 'add', content: 'เครื่อง Windows, workspace C:\\Users\\Supk' });
r = await mem({ target: 'memory', action: 'add', content: 'เครื่อง Windows, workspace C:\\Users\\Supk' });
assert.ok(r.text.includes('duplicate'), 'duplicate detected');

// char limit enforcement
let threw = false;
try { await mem({ target: 'user', action: 'rewrite', content: 'x'.repeat(2000) }); }
catch { threw = true; }
assert.ok(threw, 'limit enforced');

// section renders with content
const block = sections[0].text({});
assert.ok(block.includes('USER PROFILE') && block.includes('AGENT NOTES'), 'block has headers');
console.log('--- injected block ---\n' + block.slice(0, 400));

// history import against real session logs
const h = await tools.memory_history.execute({ sessions: 5, maxChars: 3000 });
console.log('--- history head ---\n' + h.text.slice(0, 500));
assert.ok(h.text.startsWith('Scanned'), 'history header');

console.log('\nALL SMOKE TESTS PASSED');
