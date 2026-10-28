// Instagram / Facebook rows in the v5 adapter (the importers were removed 2026-10-28; rows already indexed still render): who said a DM line, document badges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hubThread, hubConv, hubDocHit } from './adapter.mjs';

test('a DM thread names the other person; the owner is You; Instagram / Facebook rows carry their labels', () => {
  const t = hubThread({ conversation: { id: 'instagram:pal_1', title: 'Placeholder Pal' }, messages: [
    { id: 'a', role: 'user', at: '2026-10-02T18:00:00Z', text: 'hi' },
    { id: 'b', role: 'other', at: '2026-10-02T18:01:00Z', text: 'hello', tool_name: 'Placeholder Pal' },
    { id: 'c', role: 'other', at: '2026-10-02T18:02:00Z', text: 'who' }] });
  assert.deepEqual(t.messages.map((m) => [m.who, m.toolName, m.tool]), [['You', null, false], ['Placeholder Pal', null, false], ['Them', null, false]]);
  assert.equal(hubConv({ id: 'facebook:x', source: 'facebook' }).sourceLabel, 'Facebook');
  assert.equal(hubDocHit({ id: 'social:instagram:posts:x:0', source: 'social', origin: 'instagram', title: 'Instagram · your posts' }).badge, 'Instagram');
});

