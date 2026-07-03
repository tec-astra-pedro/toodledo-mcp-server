/**
 * End-to-end check of every MCP tool against the live Toodledo API.
 *
 * Spawns the real built server (build/index.js) over stdio and drives it
 * with the MCP SDK client — the same stack Claude Desktop uses. Mutating
 * tools only ever touch artifacts created by this run (prefixed E2E-TEST-),
 * and everything created is deleted before exit, so the account ends the
 * run unchanged.
 *
 * Requires: a populated .env (client id/secret), a valid .toodledo-token.json
 * (run `npm run auth` first), and a fresh `npm run build`. Not run in CI.
 *
 * Usage: npm run e2e
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = `E2E-TEST-${Date.now()}`;

interface CheckResult {
  tool: string;
  action: string;
  ok: boolean;
  detail: string;
}
const results: CheckResult[] = [];

function record(tool: string, action: string, ok: boolean, detail: string) {
  results.push({ tool, action, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${tool} — ${action}${ok ? '' : `: ${detail}`}`);
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(ROOT, 'build', 'index.js')],
    cwd: ROOT,
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'e2e', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // Tool call helper: treats isError responses and thrown errors uniformly.
  async function call(name: string, args: Record<string, any> = {}): Promise<{ ok: boolean; data: any; raw: any; error?: string }> {
    try {
      const res: any = await client.callTool({ name, arguments: args });
      if (res.isError) {
        return { ok: false, data: null, raw: res, error: res.content?.[0]?.text ?? 'unknown tool error' };
      }
      return { ok: true, data: res.structuredContent?.result, raw: res };
    } catch (err: any) {
      return { ok: false, data: null, raw: null, error: err.message };
    }
  }

  // Track created artifacts for cleanup.
  // List IDs are hex strings; the others are numbers.
  const created: { folderId?: number; listId?: string; taskId?: number; noteId?: number } = {};

  try {
    // --- ping ---
    {
      const r = await call('ping');
      record('ping', 'responds', r.ok, r.error ?? '');
    }

    // --- read-only tools ---
    {
      const r = await call('get_folders');
      record('get_folders', 'returns an array', r.ok && Array.isArray(r.data), r.error ?? `data: ${JSON.stringify(r.data)?.slice(0, 120)}`);
    }
    {
      const r = await call('get_lists');
      record('get_lists', 'returns an array', r.ok && Array.isArray(r.data), r.error ?? `data: ${JSON.stringify(r.data)?.slice(0, 120)}`);
    }
    {
      const r = await call('get_notes', { params: { num: 5 } });
      record('get_notes', 'returns an array', r.ok && Array.isArray(r.data), r.error ?? `data: ${JSON.stringify(r.data)?.slice(0, 120)}`);
    }
    {
      const r = await call('get_tasks', { params: { comp: 0, num: 10 } });
      const tasks = Array.isArray(r.data) ? r.data.filter((t: any) => 'completed' in t) : [];
      const allOpen = tasks.every((t: any) => t.completed === 0);
      record('get_tasks', 'comp:0 filter returns only open tasks', r.ok && allOpen, r.error ?? `completed tasks in response: ${tasks.filter((t: any) => t.completed !== 0).length}`);
    }

    // --- folders lifecycle ---
    {
      const r = await call('add_folder', { name: `${PREFIX}-folder` });
      // Toodledo add returns an array of created folders.
      const folder = Array.isArray(r.data) ? r.data[0] : r.data;
      created.folderId = folder?.id;
      const ok = r.ok && typeof created.folderId === 'number' && !folder?.errorCode;
      record('add_folder', 'creates a folder and returns its id', ok, r.error ?? `response: ${JSON.stringify(r.data)?.slice(0, 200)}`);
    }
    if (created.folderId) {
      const r = await call('edit_folder', { id: created.folderId, name: `${PREFIX}-folder-renamed` });
      const g = await call('get_folders');
      const found = Array.isArray(g.data) ? g.data.find((f: any) => f.id === created.folderId) : null;
      const ok = r.ok && found?.name === `${PREFIX}-folder-renamed`;
      record('edit_folder', 'renames the folder (verified via get_folders)', ok, r.error ?? `folder now: ${JSON.stringify(found)?.slice(0, 200)}`);
    } else {
      record('edit_folder', 'skipped', false, 'no folder id from add_folder');
    }

    // --- tasks lifecycle ---
    {
      const r = await call('add_task', { title: `${PREFIX}-task`, folder: created.folderId });
      const task = Array.isArray(r.data) ? r.data[0] : r.data;
      created.taskId = task?.id;
      const ok = r.ok && typeof created.taskId === 'number' && !task?.errorCode;
      record('add_task', 'creates a task and returns its id', ok, r.error ?? `response: ${JSON.stringify(r.data)?.slice(0, 200)}`);
    }
    if (created.taskId) {
      const r = await call('edit_task', { id: created.taskId, title: `${PREFIX}-task-renamed` });
      // `folder` is opt-in via the fields param — request it to verify the
      // task actually landed in the folder created above.
      const g = await call('get_tasks', { params: { comp: 0, fields: 'folder' } });
      const found = Array.isArray(g.data) ? g.data.find((t: any) => t.id === created.taskId) : null;
      const ok = r.ok && found?.title === `${PREFIX}-task-renamed` && found?.folder === created.folderId;
      record('edit_task', 'renames the task and confirms folder placement (verified via get_tasks)', ok, r.error ?? `task now: ${JSON.stringify(found)?.slice(0, 200)}`);
    } else {
      record('edit_task', 'skipped', false, 'no task id from add_task');
    }

    // --- notes lifecycle ---
    {
      const r = await call('add_note', { notes: [{ title: `${PREFIX}-note`, text: 'e2e body' }] });
      const note = Array.isArray(r.data) ? r.data[0] : r.data;
      created.noteId = note?.id;
      const ok = r.ok && typeof created.noteId === 'number' && !note?.errorCode;
      record('add_note', 'creates a note and returns its id', ok, r.error ?? `response: ${JSON.stringify(r.data)?.slice(0, 200)}`);
    }
    if (created.noteId) {
      const r = await call('edit_note', { id: created.noteId, text: 'e2e body edited' });
      const g = await call('get_notes', { params: { id: created.noteId } });
      const found = Array.isArray(g.data) ? g.data.find((n: any) => n.id === created.noteId) : null;
      const ok = r.ok && found?.text === 'e2e body edited';
      record('edit_note', 'edits the note text (verified via get_notes)', ok, r.error ?? `note now: ${JSON.stringify(found)?.slice(0, 200)}`);
    } else {
      record('edit_note', 'skipped', false, 'no note id from add_note');
    }

    // --- lists lifecycle ---
    {
      const r = await call('add_list', { title: `${PREFIX}-list` });
      const list = Array.isArray(r.data) ? r.data[0] : r.data;
      created.listId = list?.id;
      // List IDs are hex strings, not numbers.
      const ok = r.ok && typeof created.listId === 'string' && created.listId.length > 0 && !list?.errorCode;
      record('add_list', 'creates a list and returns its id', ok, r.error ?? `response: ${JSON.stringify(r.data)?.slice(0, 200)}`);
    }
    if (created.listId) {
      const r = await call('edit_list', { id: created.listId, title: `${PREFIX}-list-renamed` });
      const g = await call('get_lists', { params: { id: created.listId } });
      const found = Array.isArray(g.data) ? g.data.find((l: any) => l.id === created.listId) : null;
      const ok = r.ok && found?.title === `${PREFIX}-list-renamed`;
      record('edit_list', 'renames the list (verified via get_lists)', ok, r.error ?? `list now: ${JSON.stringify(found)?.slice(0, 200)}`);
    } else {
      record('edit_list', 'skipped', false, 'no list id from add_list');
    }

    // --- deletions (also the cleanup) ---
    if (created.noteId) {
      const r = await call('delete_note', { ids: [created.noteId] });
      const g = await call('get_notes', { params: { id: created.noteId } });
      const stillThere = Array.isArray(g.data) && g.data.some((n: any) => n.id === created.noteId);
      record('delete_note', 'deletes the note (verified gone)', r.ok && !stillThere, r.error ?? (stillThere ? 'note still present' : ''));
      if (r.ok && !stillThere) created.noteId = undefined;
    } else {
      record('delete_note', 'skipped', false, 'no note to delete');
    }
    if (created.taskId) {
      const r = await call('delete_task', { ids: [created.taskId] });
      const g = await call('get_tasks', { params: { id: created.taskId } });
      const stillThere = Array.isArray(g.data) && g.data.some((t: any) => t.id === created.taskId);
      record('delete_task', 'deletes the task (verified gone)', r.ok && !stillThere, r.error ?? (stillThere ? 'task still present' : ''));
      if (r.ok && !stillThere) created.taskId = undefined;
    } else {
      record('delete_task', 'skipped', false, 'no task to delete');
    }
    if (created.listId) {
      const r = await call('delete_list', { ids: [created.listId] });
      const g = await call('get_lists', { params: { id: created.listId } });
      const stillThere = Array.isArray(g.data) && g.data.some((l: any) => l.id === created.listId);
      record('delete_list', 'deletes the list (verified gone)', r.ok && !stillThere, r.error ?? (stillThere ? 'list still present' : ''));
      if (r.ok && !stillThere) created.listId = undefined;
    } else {
      record('delete_list', 'skipped', false, 'no list to delete');
    }
    if (created.folderId) {
      const r = await call('delete_folder', { ids: [created.folderId] });
      const g = await call('get_folders');
      const stillThere = Array.isArray(g.data) && g.data.some((f: any) => f.id === created.folderId);
      record('delete_folder', 'deletes the folder (verified gone)', r.ok && !stillThere, r.error ?? (stillThere ? 'folder still present' : ''));
      if (r.ok && !stillThere) created.folderId = undefined;
    } else {
      record('delete_folder', 'skipped', false, 'no folder to delete');
    }
  } finally {
    // Report anything that leaked so it can be cleaned up manually — every
    // artifact is prefixed and easy to find in the Toodledo UI.
    const leaked = Object.entries(created).filter(([, v]) => v !== undefined);
    if (leaked.length > 0) {
      console.error(`\n⚠ Leaked test artifacts (prefix ${PREFIX}): ${leaked.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    await client.close();
  }

  // --- summary ---
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  ✗ ${f.tool} — ${f.action}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('E2E run crashed:', err);
  process.exit(1);
});
