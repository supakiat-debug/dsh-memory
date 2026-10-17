# dsh-memory

Plugin สำหรับ DSH (DeepSeek Harness) ที่จำพฤติกรรม ความชอบ และรสนิยมของผู้ใช้จากประวัติการพูดคุย
ได้แรงบันดาลใจจาก OpenClaw (USER.md/MEMORY.md ใน workspace) และ Hermes Agent (memory budget,
background review, import history)

## หลักการทำงาน
- เก็บความจำในไฟล์ Markdown ที่คนแก้ได้: `$DSH_HOME/memory/USER.md` (โปรไฟล์ผู้ใช้) และ
  `$DSH_HOME/memory/MEMORY.md` (บันทึกสภาพแวดล้อม/ข้อค้นพบ) เป็น bullet list
- ฉีดสองไฟล์นี้เข้า system prompt ของทุก session (section `memory:profile`, มี header บอก % usage)
- Tool `memory` — read / add / patch / remove / rewrite พร้อม character budget (กันโปรไฟล์บวม)
- Tool `memory_history` — import ประวัติแชตจาก session logs จริง (`~/.dsh/sessions/**/*.jsonl.zstd`,
  ถอด zstd หลาย frame ด้วย node:zlib) คืนเป็น digest ของข้อความผู้ใช้ (ข้าม system-reminder /
  runtime-context / session ปัจจุบัน) ให้ agent วิเคราะห์เองแล้วกลั่นลง `memory`

## Workflow ใช้งาน
1. เปิด session ใหม่แล้วพูดเช่น "วิเคราะห์ประวัติแล้วสร้างโปรไฟล์ฉัน"
2. Agent เรียก `memory_history` → วิเคราะห์ → เรียก `memory` (target user) เขียน bullets
3. Session ถัดไปทั้งหมดจะได้เห็นโปรไฟล์นั้นใน system prompt อัตโนมัติ

## Config (ใน cordis.patch.yml แถว `user-memory`)
- `memoryDir` (default `$DSH_HOME/memory`), `sessionsRoot` (default `$DSH_HOME/sessions`)
- `userCharLimit` 1375, `memoryCharLimit` 2200, `injectProfile` true
- `historyDefaultSessions` 10, `historyMaxChars` 60000

## ติดตั้ง (profile web)
1. เพิ่ม `"dsh-memory": "link:C:/Users/Supk/dsh/dsh-memory"` ใน dependencies + `"dsh-memory"` ใน
   `dsh.profile.bundles` ของ `~/.dsh/profiles/web/package.json`
2. `dsh plugin --profile web install` (ทำตอน harness ไม่รัน หรือ lockfile จะติด file lock)
3. รีสตาร์ท `dsh web` — bundle patch ของ package นี้จะ insert แถว `user-memory` เอง
4. ตรวจ: `dsh --profile web --dump-config | Select-String user-memory`

## ทดสอบ
`node test-smoke.mjs` (ต้อง shim `@deepseek-ai/dsh-tools` ให้ resolve ได้ เช่น junction ชั่วคราว)
