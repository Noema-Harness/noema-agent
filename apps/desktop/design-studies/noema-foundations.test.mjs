import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(
  new URL('./noema-continuity-structures.html', import.meta.url),
  'utf8',
);
const script = html.match(/<script id="study-runtime">([\s\S]*?)<\/script>/)[1];
const context = createContext({ setTimeout, clearTimeout });
new Script(
  script + '\nthis.Conversation = StudyConversation; this.Work = StudyWork;',
).runInContext(context);
const { Conversation, Work } = context;
function fixture() {
  const callbacks = [];
  const cancelled = new Set();
  const model = new Conversation(
    () => {},
    (fn) => {
      callbacks.push(fn);
      return callbacks.length - 1;
    },
    (id) => cancelled.add(id),
  );
  return { model, callbacks, cancelled };
}
const input = (text) => ({
  text,
  files: [],
  model: 'first-model',
  response: 'demo response',
});

test('one active reply per room; queued inputs are not yet delivered messages', () => {
  const { model } = fixture();
  model.send('core', input('one'));
  model.send('core', input('two'));
  assert.equal(model.room('core').messages.length, 2);
  assert.equal(model.room('core').queue.length, 1);
  model.send('private-research', input('private'));
  assert.equal(model.room('private-research').messages[0].text, 'private');
  assert.equal(
    model.room('core').messages.some((m) => m.text === 'private'),
    false,
  );
});
test('finishing a reply promotes its queue exactly once', () => {
  const { model } = fixture();
  model.send('core', input('one'));
  const gen = model.room('core').active.generation;
  model.send('core', input('two'));
  assert.equal(model.finish('core', gen, 'done'), true);
  assert.equal(model.finish('core', gen, 'stale'), false);
  assert.equal(
    model.room('core').messages.filter((m) => m.role === 'user').length,
    2,
  );
});
test('stop preserves partial text, cancels timers, and keeps queued work paused', () => {
  const { model, callbacks, cancelled } = fixture();
  model.send('core', input('one'));
  callbacks[0]();
  model.send('core', input('two'));
  const partial = model.room('core').active.reply.text;
  model.interrupt('core');
  callbacks[1]();
  assert.equal(model.room('core').messages[1].text, partial);
  assert.equal(model.room('core').messages[1].status, 'stopped');
  assert.equal(model.room('core').paused, true);
  assert.equal(model.room('core').active, null);
  assert.equal(cancelled.size, 2);
});
test('retry reuses the original request and reply without duplicating user input', () => {
  const { model } = fixture();
  model.send('core', input('one'));
  const id = model.room('core').active.reply.id;
  model.interrupt('core', 'failed');
  assert.equal(model.retry('core', id), true);
  assert.equal(model.retry('core', id), false);
  assert.equal(model.room('core').messages.length, 2);
  assert.equal(model.room('core').active.reply.attempt, 2);
});
test('withdrawn queued input retains attachments and can no longer be dispatched', () => {
  const { model } = fixture();
  model.send('core', input('one'));
  const id = model.send('core', {
    ...input('two'),
    files: [{ name: 'note.txt' }],
  });
  const packet = model.withdraw('core', id);
  assert.equal(packet.files[0].name, 'note.txt');
  assert.equal(model.withdraw('core', id), null);
  assert.equal(model.prioritize('core', id), false);
});
test('stop-and-send targets the selected input; other queued work stays paused', () => {
  const { model } = fixture();
  model.send('core', input('one'));
  model.send('core', input('two'));
  const third = model.send('core', input('three'));
  assert.equal(model.prioritize('core', third), true);
  const room = model.room('core');
  assert.equal(room.active.reply.packet.text, 'three');
  model.finish('core', room.active.generation, 'done');
  assert.equal(room.active, null);
  assert.equal(room.queue[0].text, 'two');
  assert.equal(model.resume('core'), true);
  assert.equal(room.active.reply.packet.text, 'two');
});
test('queued and active requests retain their captured model', () => {
  const { model } = fixture();
  const first = input('one');
  model.send('core', first);
  model.send('core', { ...input('two'), model: 'second-model' });
  first.model = 'changed';
  assert.equal(model.room('core').active.reply.packet.model, 'first-model');
  const gen = model.room('core').active.generation;
  model.finish('core', gen, 'done');
  assert.equal(model.room('core').active.reply.packet.model, 'second-model');
});
test('reset invalidates callbacks belonging to the previous demonstration', () => {
  const { model, callbacks } = fixture();
  model.send('core', input('old'));
  model.reset();
  model.send('core', input('new'));
  callbacks[0]();
  callbacks[1]();
  assert.equal(model.room('core').active.reply.packet.text, 'new');
  assert.equal(model.room('core').messages[1].text, '');
});
test('permission is required; repeat and stale approvals cannot start another execution', () => {
  const work = new Work();
  const generation = work.generation;
  assert.equal(work.advance(), false);
  assert.equal(work.decide(generation, 'once'), true);
  assert.equal(work.decide(generation, 'project'), false);
  assert.equal(work.status, 'running');
});
test('reject leaves every step untouched; an old approval stays invalid after reapplying', () => {
  const work = new Work();
  const old = work.generation;
  assert.equal(work.decide(old, 'deny'), true);
  assert.equal(
    work.steps.every((s) => s.state === 'pending'),
    true,
  );
  assert.equal(work.requestAccess(), true);
  assert.equal(work.decide(old, 'once'), false);
  assert.equal(work.decide(work.generation, 'once'), true);
});
test('connection failure after a write requires reconciliation before retry', () => {
  const work = new Work();
  work.decide(work.generation, 'once');
  work.advance();
  work.interrupt();
  assert.equal(work.uncertain, true);
  assert.equal(work.resume(), true);
  assert.equal(work.status, 'checking');
  assert.equal(work.advance(), false);
  work.reconcile(true);
  assert.equal(work.steps[0].state, 'complete');
  assert.equal(work.steps[1].state, 'complete');
  assert.equal(work.steps[2].state, 'running');
});
test('confirmed missing write resumes only that step and preserves finished reads', () => {
  const work = new Work();
  work.decide(work.generation, 'project');
  work.advance();
  work.interrupt();
  work.resume();
  work.reconcile(false);
  assert.equal(work.steps[0].state, 'complete');
  assert.equal(work.steps[1].state, 'running');
});
test('revoking access stops the task; regranting cannot skip uncertain write reconciliation', () => {
  const work = new Work();
  work.decide(work.generation, 'project');
  work.advance();
  work.revoke();
  assert.equal(work.status, 'revoked');
  assert.equal(work.resume(), false);
  work.requestAccess();
  work.decide(work.generation, 'once');
  assert.equal(work.status, 'checking');
  work.reconcile(true);
  work.advance();
  assert.equal(work.status, 'complete');
});
