// Placeholder claude.ai export builder for tests and gates. Placeholder text only; ZIPs are written at runtime.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function zipFiles(file, files, { forceZip64 = false } = {}) {
  const parts = [], cen = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const method = f.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32(raw), usize = f.lieSize ?? raw.length;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x800, 6); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(body.length, 18); loc.writeUInt32LE(usize, 22); loc.writeUInt16LE(name.length, 26);
    parts.push(loc, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(usize, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(cen), tail = [];
  if (forceZip64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(files.length), 24); z.writeBigUInt64LE(BigInt(files.length), 32);
    z.writeBigUInt64LE(BigInt(cd.length), 40); z.writeBigUInt64LE(BigInt(off), 48);
    const l = Buffer.alloc(20);
    l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(off + cd.length), 8); l.writeUInt32LE(1, 16);
    tail.push(z, l);
  }
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(forceZip64 ? 0xffff : files.length, 8); e.writeUInt16LE(forceZip64 ? 0xffff : files.length, 10);
  e.writeUInt32LE(forceZip64 ? 0xffffffff : cd.length, 12); e.writeUInt32LE(forceZip64 ? 0xffffffff : off, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, ...tail, e]));
}
// Placeholder claude.ai export rows covering the field variants seen across export generations.
export function exportFixture() {
  return {
    conversations: [
      { uuid: 'web-chat-1', name: 'Release planning (web)', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:10:00Z',
        project_uuid: 'web-proj-1', model: 'claude-placeholder',
        chat_messages: [
          { uuid: 'web-msg-1', sender: 'human', created_at: '2026-10-01T09:00:00Z', text: 'Plan the release for project-a', content: [{ type: 'text', text: 'Plan the release for project-a' }] },
          { uuid: 'web-msg-2', sender: 'assistant', created_at: '2026-10-01T09:01:00Z', parent_message_uuid: 'web-msg-1',
            content: [{ type: 'text', text: 'Here is a release plan.' }, { type: 'thinking', thinking: 'hidden reasoning' }, { type: 'tool_use', name: 'web_search', input: { query: 'example.org' } }] },
        ] },
      { id: 'web-chat-2', title: 'Café notes 🚀', create_time: 1759309200, mystery_field: { nested: 'placeholder' },
        messages: [{ role: 'user', create_time: 1759309200, text: 'Hello from example.org' }, 42] },
      { uuid: 'web-chat-3', name: '', created_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-02T10:05:00Z',
        chat_messages: [
          { uuid: 'web-msg-3', sender: 'human', created_at: '2026-10-02T10:00:00Z', text: '', attachments: [{ file_name: 'notes.txt', extracted_content: 'attachment body, not indexed' }] },
          { uuid: 'web-msg-4', sender: 'assistant', created_at: '2026-10-02T10:01:00Z', content: [{ type: 'widget', data: 1 }, { type: 'text', text: 'Answer' }] },
          { uuid: 'web-msg-5', sender: 'assistant', created_at: '2026-10-02T10:02:00Z', text: '' },
        ] },
      'oops',
      { name: 'no id here', chat_messages: [] },
    ],
    projects: [
      { uuid: 'web-proj-1', name: 'project-a (claude.ai)', description: 'Placeholder', created_at: '2026-09-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z',
        docs: [{ filename: 'brief.md', content: 'Placeholder brief' }] },
      { name: 'no uuid' },
    ],
  };
}
export const exportJson = () => { const f = exportFixture(); return { conversations: JSON.stringify(f.conversations), projects: JSON.stringify(f.projects) }; };
