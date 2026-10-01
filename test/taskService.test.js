import test from 'node:test';
import assert from 'node:assert/strict';
import { taskState } from '../src/services/tasks/taskService.js';
import { addTaskLiveClient, publishTaskEvent, taskLiveClientCount } from '../src/services/tasks/taskLiveService.js';

test('taskState resolves published scheduling boundaries', () => {
  const now = new Date('2026-08-29T12:00:00Z');
  assert.equal(taskState({ status: 'published' }, now), 'active');
  assert.equal(taskState({ status: 'published', startsAt: '2026-08-30T00:00:00Z' }, now), 'upcoming');
  assert.equal(taskState({ status: 'published', endsAt: '2026-08-29T00:00:00Z' }, now), 'expired');
  assert.equal(taskState({ status: 'closed' }, now), 'closed');
});

test('task live broadcaster registers, publishes, and removes clients', () => {
  const messages = [];
  const response = { write(value) { messages.push(value); } };
  const remove = addTaskLiveClient(response);
  assert.equal(taskLiveClientCount(), 1);
  publishTaskEvent('task-updated', { taskId: '123' });
  assert.match(messages[0], /event: task-updated/);
  assert.match(messages[0], /"taskId":"123"/);
  remove();
  assert.equal(taskLiveClientCount(), 0);
});
