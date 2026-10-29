// Placeholder claude.ai conversations / projects (the shapes live sync pushes) for tests. Placeholder text only.

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
