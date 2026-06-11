/** Минимальный реактивный store — лёгкие сигналы без фреймворка (план §2.1). */
export interface Store<T> {
  get(): T;
  set(value: T): void;
  update(fn: (v: T) => T): void;
  subscribe(fn: (v: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(v) {
      value = v;
      subs.forEach((fn) => fn(value));
    },
    update(fn) {
      this.set(fn(value));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
