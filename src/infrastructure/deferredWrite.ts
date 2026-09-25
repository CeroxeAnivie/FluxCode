/** Coalesce input bursts, but bound the unsaved interval during continuous typing. */
export function deferredWrite<T>(
  write: (value: T) => void,
  changed: (state: 'pending' | 'saved' | 'failed', error?: unknown) => void,
  delay = 300,
  maxWait = 1000,
) {
  let pending: { value: T } | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function clear() {
    clearTimeout(debounce);
    clearTimeout(deadline);
    debounce = deadline = undefined;
  }
  function flush(): boolean {
    clear();
    if (!pending) return true;
    try {
      write(pending.value);
      pending = undefined;
      changed('saved');
      return true;
    } catch (error) {
      changed('failed', error);
      return false;
    }
  }
  return {
    schedule(value: T) {
      pending = { value };
      changed('pending');
      clearTimeout(debounce);
      debounce = setTimeout(flush, delay);
      deadline ??= setTimeout(flush, maxWait);
    },
    flush,
    cancel() {
      clear();
      pending = undefined;
    },
  };
}
