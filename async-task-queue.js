class AsyncTaskQueue {
  constructor(maxSize = 100) {
    this.maxSize = Number.isFinite(maxSize) ? maxSize : 100;
    this.depth = 0;
    this.chain = Promise.resolve();
  }

  setMaxSize(maxSize) {
    this.maxSize = Number.isFinite(maxSize) ? maxSize : this.maxSize;
  }

  enqueue(taskFn) {
    if (this.maxSize > 0 && this.depth >= this.maxSize) {
      const err = new Error(`翻譯佇列已滿（max=${this.maxSize}）`);
      err.code = 'QUEUE_FULL';
      return Promise.reject(err);
    }

    this.depth += 1;
    const run = this.chain.then(taskFn, taskFn);
    const settled = run.finally(() => {
      this.depth = Math.max(0, this.depth - 1);
    });
    this.chain = settled.catch(() => {});
    return run;
  }
}

module.exports = {
  AsyncTaskQueue
};
