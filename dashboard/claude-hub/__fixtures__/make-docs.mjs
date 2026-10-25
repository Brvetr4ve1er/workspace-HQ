// Placeholder ~/.claude (memory notes, CLAUDE.md, history.jsonl) and a placeholder vault Prompts folder (spec 2026-10-15
// §5.2, §6.1, §9). Placeholder text only; the secret-shaped string is passed in, built at runtime by the test.
import fs from 'node:fs';
import path from 'node:path';

const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); return f; };
export const FOLDER = 'C--placeholder-project-a';

export function makeDocsHome(dir, { secret = '' } = {}) {
  const home = path.join(dir, '.claude'), vault = path.join(dir, 'vault'), prompts = path.join(vault, '40_Resources', 'Prompts');
  const projectDir = path.join(dir, 'work', 'project-a');
  const mem = path.join(home, 'projects', FOLDER, 'memory');
  const files = {
    memIndex: w(path.join(mem, 'MEMORY.md'), '# Memory index\n\n- [Tea](feedback_tea.md) — placeholder\n'),
    memTea: w(path.join(mem, 'feedback_tea.md'), '---\nname: Placeholder tea rule\ndescription: always offer tea\ntype: feedback\n---\nOffer placeholder tea first. ' + secret + '\n'),
    homeMd: w(path.join(home, 'CLAUDE.md'), '# Placeholder global rules\nBe kind to lanterns.\n'),
    projMd: w(path.join(projectDir, 'CLAUDE.md'), '# Project A rules\nPlaceholder build steps.\n'),
    prompt: w(path.join(prompts, 'review-a-pr.md'), [
      '---', 'title: Review a PR like a staff engineer', 'tags: [review, code]', 'variables: [project, file]', 'version: 1',
      'created: 2026-10-15T10:00:00Z', 'source: { kind: code, conversation: "code:s1", at: "2026-09-02T14:03:00Z" }',
      'hq: { id: "prompt:placeholder" }', '---', 'You are reviewing {{file}} in {{project}}. Placeholder body.', ''].join('\n')),
  };
  w(path.join(prompts, 'notes.txt'), 'not a note');
  w(path.join(prompts, 'drafts', 'nested.md'), '# nested is not indexed');
  w(path.join(home, 'projects', FOLDER, 's1.jsonl'), '');   // the project folder exists like a real one
  return { home, vault, prompts, projectDir, files };
}

export function historyLine({ display, sessionId = 'sess-1', project = 'C:\\placeholder\\project-a', pasted = false, timestamp = 1759320000000 }) {
  return JSON.stringify({ display, pastedContents: pasted ? { 1: { id: 1, type: 'text', content: 'placeholder paste' } } : {}, timestamp, project, sessionId }) + '\n';
}
