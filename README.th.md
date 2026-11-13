# dsh-memory

ปลั๊กอินเพิ่มความจำถาวรแบบมีงบให้ [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
เก็บโปรไฟล์ของ *คุณ* — ภาษา น้ำเสียง สไตล์ ข้อเท็จจริงของเครื่อง — ไว้ในไฟล์ Markdown สองไฟล์
ส่งให้โมเดลทุก step และทำโดย **ไม่ทำให้ prefix cache พัง** ตอนที่มีการแก้ความจำ

[English](README.md) · **ไทย**

---

## ทำไมต้องมีปลั๊กอินนี้

LLM เป็น stateless ทุก step ยิง system prompt ทั้งก้อนซ้ำอยู่แล้ว — การ "อ่านเมมโมรี่ซ้ำ" ไม่ใช่ต้นทุน
สิ่งที่แพงจริงคือ **การทำให้ prefix / KV cache หลุด**

วิธีที่คนเขียนกันทั่วไปคือลงทะเบียนโปรไฟล์เป็น *section* ของ system prompt ซึ่งข้อความนั้นจะกลายเป็น
ส่วนหนึ่งของ system message หัวก้อน (node 0) บน route ที่ไม่ประกาศ `systemPromptUpdate: 'in-history'`
— ซึ่งคือทุก route แบบ `openai-completions` หรือทุกเซิร์ฟเวอร์ local อย่าง `llama.cpp` / `strata` —
การแก้ bullet เดียวจะ **เขียน node 0 ใหม่** request จึงต่างตั้งแต่ token แรกและ re-prefill ทั้ง context
บน GPU ในเครื่องแปลว่าหายืนรอเป็นวินาที ต่อการแก้หนึ่งครั้ง ไปเรื่อย ๆ
การย้าย section ไปไว้ท้าย prompt **ไม่ช่วย** เพราะ system message อยู่ก่อน history ทั้งก้อน

`dsh-memory` แก้ด้วยกลไกเดียวกับที่ผล tool ใช้อยู่แล้ว — **append อย่าเขียนทับ**:

```
head system message (node 0)   →  โปรไฟล์ (ถูก freeze ตอน session ประกอบ prompt ครั้งแรก)
history                        →  … บทสนทนา …
user message สุดท้าย            →  snapshot memory:update มีเฉพาะบรรทัดที่เปลี่ยน
```

harness จะสร้าง runtime-context snapshot ก็ต่อเมื่อข้อความ **ต่างจากอันที่ retain ไว้**
session ที่ไม่แก้อะไรจึงใช้ **0 token** และ session ที่แก้ความจำจะ append ไม่กี่บรรทัดแทนการเขียนหัวใหม่

## สิ่งที่ได้

- ไฟล์ที่คนแก้ได้ 2 ไฟล์ใน `$DSH_HOME/memory/`
  - `USER.md` — ผู้ใช้เป็นใคร ภาษา น้ำเสียง สไตล์การจัดรูปแบบ งานที่ทำซ้ำบ่อย
  - `MEMORY.md` — ข้อเท็จจริงของสภาพแวดล้อม ข้อตกลง บทเรียนที่เจ็บตัวมา
- Tool `memory` — `read` / `add` / `patch` / `remove` / `rewrite` พร้อมงบตัวอักษรต่อไฟล์ กันโปรไฟล์บวม
  และกันเพิ่มซ้ำตอน `add`
- Tool `memory_history` — import ประวัติแชตจาก session logs จริง (`$DSH_HOME/sessions/**/*.jsonl[.zstd]`
  ถอด zstd หลาย frame ด้วย `node:zlib`) เป็น digest ของข้อความฝั่งผู้ใช้ (ข้าม system-reminder,
  runtime-context และ session ปัจจุบัน) ให้ agent วิเคราะห์เองแล้วกลั่นลง `memory`
- โหมดการส่งเข้า prompt 4 แบบ (ดูข้างล่าง) ค่าเริ่มต้นคือ `hybrid` ที่ cache-friendly

## โหมดการส่งเข้า prompt (`injectMode`)

| โหมด | โปรไฟล์อยู่ที่ไหน | ต้นทุนตอนความจำเปลี่ยน |
| --- | --- | --- |
| `hybrid` (ค่าเริ่มต้น) | freeze ใน system prompt **ราย session** + snapshot `memory:update` ต่อท้าย history | append แค่ delta cache อยู่รอด |
| `section` | สดใน system prompt | เขียน node 0 ใหม่ → re-prefill ทั้ง context |
| `context` | เป็น runtime-context snapshot อย่างเดียว | สร้าง snapshot ใหม่ทับอันเก่า หัวไม่ถูกแตะ |
| `off` | ไม่ฉีดเลย โมเดลต้องเรียก `memory` action `read` เอง | ไม่มีเลย แต่เสีย passive style-matching |

หมายเหตุ

- ในโหมด `hybrid` ตัว block เองเขียนบอกว่าตัวเองถูก freeze และมีบรรทัด "snapshot ใหม่กว่าชนะ"
  โมเดลจึงไม่ยึดบรรทัดเก่าในหัวเป็นตัวปัจจุบัน
- snapshot แยกตามไฟล์และทิศ: `[USER PROFILE — added this session]`, `[AGENT NOTES — no longer current]`
  แสดงเฉพาะบรรทัดที่เปลี่ยนจริง
- ถ้า delta รวมของ session ยาวเกิน `deltaCharLimit` (แค่ `rewrite` ทั้งไฟล์ก็เกินแล้ว) snapshot จะส่ง
  **ข้อความเต็มปัจจุบัน** แทน diff เพราะ diff ขนาด rewrite คือเสียงรบกวน และการบอกให้ไปเรียก
  `memory read` ก็จ่ายข้อความเท่ากันอยู่ดี แค่เสีย round trip เพิ่ม
- `injectProfile: false` ยังใช้ได้ และเท่ากับ `off`
- ข้อความจากความจำไม่เคยถูกตีความเป็นแม่แบบ prompt: section ลงทะเบียนด้วย `interpolate: false`
  และทุก block ที่ render จะถูกแยก `{{` ออกจากกัน ทำให้ bullet ที่มี `{{example}}` ไม่ทำให้การประกอบ
  prompt ทั้งก้อนล้ม

## ความต้องการระบบ

- DSH (CLI / harness `dsh`) — พัฒนาและทดสอบบน `0.1.7-rc.2`
- Node.js ≥ 22.15 (`zlib.zstdDecompressSync` สำหรับถอด log session ที่บีบอัด)
- อย่างอื่นไม่ต้องมี `@deepseek-ai/cordis` กับ `@deepseek-ai/dsh-tools` มาจากตัว harness อยู่แล้ว

## ติดตั้ง

1. เพิ่มปลั๊กอินลงโปรไฟล์ DSH เช่น `~/.dsh/profiles/web/package.json`

   ```jsonc
   {
     "dependencies": {
       "dsh-memory": "github:supakiat-debug/dsh-memory"   // หรือ "link:C:/path/to/dsh-memory"
     },
     "dsh": {
       "profile": {
         "bundles": ["dsh-memory"]
       }
     }
   }
   ```

2. ติดตั้งตอน **harness ไม่ได้รัน** (ระหว่าง `dsh web` ทำงาน lockfile ถูกล็อกอยู่)

   ```sh
   dsh plugin --profile web install
   ```

3. รีสตาร์ท harness (`dsh web`) — plugin ถูกโหลดตอน boot เท่านั้น แก้โค้ดหรือ config เสร็จต้อง restart

4. ตรวจว่าแถว plugin เข้าแล้ว (แพ็กเกจนี้มี bundle patch ที่ insert แถว `user-memory` ให้เอง)

   ```powershell
   dsh --profile web --dump-config | Select-String user-memory
   ```

5. ตรวจในแชต — session ใหม่ต้องเห็น block ที่มีคำว่า `FROZEN` และหลัง agent เขียน memory ต้องเห็น
   บล็อก `MEMORY UPDATE` ต่อท้ายบทสนทนา (Web UI จะแสดงเป็น context section ชื่อ `memory:update`)

## Config (ใส่ใต้ `user-memory` ใน cordis.patch.yml)

| ฟิลด์ | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `memoryDir` | `$DSH_HOME/memory` | ที่เก็บ `USER.md` / `MEMORY.md` |
| `sessionsRoot` | `$DSH_HOME/sessions` | โฟลเดอร์ log ที่ `memory_history` อ่าน |
| `userCharLimit` | `1375` | งบตัวอักษรของ `USER.md` |
| `memoryCharLimit` | `2200` | งบตัวอักษรของ `MEMORY.md` |
| `injectMode` | `hybrid` | `hybrid` \| `section` \| `context` \| `off` |
| `injectProfile` | `true` | สวิตช์เก่า `false` = `off` |
| `deltaCharLimit` | `1400` | ขนาด snapshot ที่เกินแล้วจะเปลี่ยนจาก diff เป็นส่งข้อความเต็มปัจจุบัน |
| `historyDefaultSessions` | `10` | จำนวน session ที่ `memory_history` อ่านเมื่อไม่ระบุ |
| `historyMaxChars` | `60000` | ขนาด digest เริ่มต้น |

## วิธีใช้

1. เปิด session — โปรไฟล์ล่าสุดจะถูก freeze เป็น head ของ session นั้น
2. ระหว่าง session agent เก็บข้อสรุปด้วย `memory` ทุกครั้งที่เขียนจะเห็นเป็น snapshot `MEMORY UPDATE`
   ต่อท้ายบทสนทนา บรรทัดที่ snapshot ไม่พูดถึงยังถือว่าใช้ได้
3. session ถัดไปจะ freeze ไฟล์ล่าสุดให้อัตโนมัติ baseline เก็บราย session (LRU 64) และอยู่ในหน่วยความจำ
   ของ process เท่านั้น restart harness = freeze ใหม่ทั้งหมด
4. อยากให้สร้างโปรไฟล์จากประวัติ: พูดเฉย ๆ ว่า "วิเคราะห์ประวัติแล้วสร้างโปรไฟล์ฉัน" → agent เรียก
   `memory_history` → เขียน bullets สั้น ๆ ลง `memory` (target `user`)
5. แก้ `USER.md` / `MEMORY.md` เองได้ตลอด หนึ่ง bullet หนึ่งบรรทัด ดูงบได้จาก `memory` action `read`

## ตารางเช็ก cache

| เหตุการณ์ | head ถูก re-prefill? | token ที่ append |
| --- | --- | --- |
| step ปกติ ไม่แก้ความจำ | ไม่ | 0 |
| เขียน memory ระหว่าง session | ไม่ | เฉพาะ delta (ถ้าใหญ่ระดับ rewrite จะส่งข้อความเต็ม) |
| session ใหม่หลังแก้ไฟล์ | ใช่ ครั้งเดียว | 0 |
| `injectMode: section` แล้วแก้ | ใช่ ทุกครั้งที่แก้ | 0 |

## พัฒนา / ทดสอบ

```sh
npm test                             # node --import ./test-register.mjs test-smoke.mjs
DSH_MEMORY_TEST_HISTORY=1 npm test   # ให้ memory_history อ่าน log จริงของคุณด้วย (ปกติไม่อ่าน)
```

ชุดทดสอบเป็นแบบ hermetic: ตัวตรวจ `memory_history` ใช้ log session ปลอม (zstd) ที่สร้างใน temp
directory จึงไม่อ่านบทสนทนาจริงของคุณ ยกเว้นจะตั้ง env var ข้างบน ส่วน CI
(`.github/workflows/ci.yml`) จะรันชุดเดียวกันนี้บน Node 22.15, 22.x และ 24.x ตาม lockfile ที่ commit ไว้

smoke test รันปลั๊กอินกับ mock Cordis context มี ESM resolve hook เล็ก ๆ (`test-hooks.mjs` +
`test-register.mjs`) จำลอง peer dependency `@deepseek-ai/dsh-tools` ที่มาจาก harness จึงไม่ต้องแตะ
`node_modules` เลย ครอบคลุม: head frozen ไม่เปลี่ยนแม้ byte เดียว, snapshot มีแต่ delta,
baseline แยกราย session, ไฟล์ว่าง, กันซ้ำ/เกิน limit, ทุก `injectMode`, โหมดแปลก ๆ ต้อง error เสียงดัง
และ `{{…}}` ต้องไม่หลุดไปใน prompt ที่ render แล้ว

## ผูกกับ harness ยังไง

- `systemPrompt.section()` — ข้อความใน system message เรียงตาม order
- `systemPrompt.context()` — runtime context แบบ dynamic เรียงตาม order แล้วรวมเป็น snapshot เดียว
  แบบ user role ซึ่ง loop จะ append ให้เฉพาะตอนข้อความเปลี่ยน `memory:update` ใช้ order `130`
  ต่อจาก sandbox (110), approval (115), subagent (120)
- `dsh-agent-loop` — `SystemPromptProjection` เขียน node 0 ทับบน route ที่ไม่รองรับ in-history ส่วน
  `RuntimeContextProjection` จะ append ความต่างนี้คือทั้งงานออกแบบ
- `dsh-time-context` — งานก่อนหน้าที่เป็นตัวอย่าง pattern pre-step snapshot ที่โผล่เฉพาะตอนถึงรอบ

## ข้อจำกัด

- baseline อยู่ในหน่วยความจำ restart harness = freeze ใหม่ (ใช้เป็นวิธีบังคับเริ่ม baseline กลางวันได้)
- snapshot เทียบแบบรายบรรทัด แก้ bullet หนึ่งอันจะเห็นเป็น "เพิ่ม 1 + ไม่ใช้แล้ว 1"
- `memory_history` อ่าน log ทุก workspace ใต้ `sessionsRoot` ถ้ารวมหลายเครื่องในโฟลเดอร์เดียวให้กำหนด
  `workspace` ช่วย หรือชี้ `sessionsRoot` ใหม่
- โหมด `off` เป็นโหมดเดียวที่ไม่ฉีดอะไรเลย คาดหวังว่า agent จะถามเองหรือเรียก `memory read`

## เครดิต

ได้ไอเดียจาก OpenClaw (`USER.md` / `MEMORY.md` ใน workspace) และ Hermes Agent (memory budget,
background review, import history)

## License

MIT — ดู [LICENSE](LICENSE)
