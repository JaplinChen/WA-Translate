const test = require('node:test');
const assert = require('node:assert/strict');

const { AsyncTaskQueue } = require('../async-task-queue');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('async queue executes tasks in order', async () => {
  const queue = new AsyncTaskQueue(10);
  const result = [];

  const p1 = queue.enqueue(async () => {
    await sleep(20);
    result.push('a');
  });
  const p2 = queue.enqueue(async () => {
    result.push('b');
  });

  await Promise.all([p1, p2]);
  assert.deepEqual(result, ['a', 'b']);
});

test('async queue rejects when max size is reached', async () => {
  const queue = new AsyncTaskQueue(1);
  const hold = queue.enqueue(async () => sleep(50));
  await sleep(5);

  await assert.rejects(
    queue.enqueue(async () => {}),
    (err) => err && err.code === 'QUEUE_FULL'
  );

  await hold;
});
