const mutationQueues = new Map<string, Promise<unknown>>();

export function withMutationQueue<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const queued = run.catch(() => undefined);
  mutationQueues.set(key, queued);
  void queued.finally(() => {
    if (mutationQueues.get(key) === queued) mutationQueues.delete(key);
  });
  return run;
}
