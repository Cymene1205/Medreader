/**
 * ES2025 / Stage-3 API polyfills for older browsers.
 *
 * Why this exists:
 *   pdfjs-dist v6.1.200 (installed in this project) uses several
 *   Stage-3 TC39 proposals that only landed in Chrome 137+ (April 2025):
 *
 *     - Math.sumPrecise(iterable)           — precise float64 summation
 *     - Map.prototype.getOrInsertComputed() — upsert with factory fn
 *     - Iterator.prototype.map/filter/take   — iterator helpers
 *
 *   On browsers even slightly older than Chrome 137 (most real-world
 *   users, especially Safari < 18.2 / Firefox < 141 / Edge < 137),
 *   pdfjs throws `TypeError: Math.sumPrecise is not a function` and
 *   `this[#methodPromises].getOrInsertComputed is not a function` —
 *   which causes PDF rendering to silently fail with a blank canvas.
 *
 *   Downgrading pdfjs-dist would lose v6 fixes; polyfilling these
 *   APIs is safer and only adds ~30 lines. The polyfills are spec-
 *   compliant enough for pdfjs's usage (it doesn't depend on the
 *   full arbitrary-precision behaviour of Math.sumPrecise; plain
 *   float64 accumulation is fine for page-text positioning math).
 *
 * This file must be imported BEFORE `import("pdfjs-dist")` runs.
 * In practice, importing it at the top of src/app/layout.tsx ensures
 * it executes before any client component mounts.
 */

/* ------------------------------------------------------------------ */
/*  Math.sumPrecise                                                    */
/*  Spec: https://github.com/tc39/proposal-math-sum                   */
/*  Returns the sum of an iterable of Numbers, with best-effort       */
/*  reduction of floating-point error (Shewchett/Neumaier naive).     */
/* ------------------------------------------------------------------ */
if (typeof (Math as any).sumPrecise !== "function") {
  Object.defineProperty(Math, "sumPrecise", {
    value: function sumPrecise(items: Iterable<number>): number {
      if (items == null) {
        throw new TypeError(
          "Cannot convert undefined or null to object"
        );
      }
      // Neumaier variant of Kahan summation — handles large magnitude
      // differences better than naive += and is only ~3x slower.
      let sum = 0;
      let c = 0; // compensation
      let count = 0;
      for (const x of items as any) {
        count++;
        if (typeof x !== "number" || !Number.isFinite(x)) {
          throw new TypeError(
            `Math.sumPrecise requires finite numbers, got: ${typeof x} ${x}`
          );
        }
        const t = sum + x;
        if (Math.abs(sum) >= Math.abs(x)) {
          c += sum - t + x;
        } else {
          c += x - t + sum;
        }
        sum = t;
      }
      // Discard empty iterable → 0 (matches spec).
      if (count === 0) return 0;
      return sum + c;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/* ------------------------------------------------------------------ */
/*  Map.prototype.getOrInsertComputed                                  */
/*  Spec: https://github.com/tc39/proposal-upsert                      */
/*  If `key` is in the map, return its value. Otherwise call          */
/*  `factory(key)` to compute a value, insert it, and return it.      */
/* ------------------------------------------------------------------ */
if (typeof (Map.prototype as any).getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    value: function getOrInsertComputed<K, V>(
      this: Map<K, V>,
      key: K,
      factory: (key: K) => V
    ): V {
      if (this.has(key)) return this.get(key) as V;
      if (typeof factory !== "function") {
        throw new TypeError("factory must be a function");
      }
      const value = factory(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/* ------------------------------------------------------------------ */
/*  Iterator.prototype.map / filter / take / drop / forEach / toArray  */
/*  Spec: https://github.com/tc39/proposal-iterator-helpers            */
/*  Only polyfill the methods pdfjs actually uses (we conservatively   */
/*  add all 6 to be safe). Implementation wraps the iterator and       */
/*  returns a new iterator.                                            */
/* ------------------------------------------------------------------ */
type AnyIterator<T> = Iterator<T> | Iterable<T>;

function toIterator<T>(it: AnyIterator<T>): Iterator<T> {
  if (typeof (it as any)[Symbol.iterator] === "function") {
    return (it as Iterable<T>)[Symbol.iterator]();
  }
  // Already an Iterator (has .next())
  return it as Iterator<T>;
}

class IteratorHelper<T> implements Iterator<T> {
  private fn: () => IteratorResult<T>;
  constructor(fn: () => IteratorResult<T>) {
    this.fn = fn;
  }
  next(): IteratorResult<T> {
    return this.fn();
  }
  [Symbol.iterator]() {
    return this;
  }
  // Also add the helper methods so chained calls work.
  map<U>(f: (v: T) => U): IteratorHelper<U> {
    const self = this;
    return new IteratorHelper<U>(function () {
      const r = self.next();
      if (r.done) return { done: true, value: undefined as any };
      return { done: false, value: f(r.value) };
    });
  }
  filter(pred: (v: T) => boolean): IteratorHelper<T> {
    const self = this;
    return new IteratorHelper<T>(function () {
      while (true) {
        const r = self.next();
        if (r.done) return { done: true, value: undefined as any };
        if (pred(r.value)) return { done: false, value: r.value };
      }
    });
  }
  take(n: number): IteratorHelper<T> {
    const self = this;
    let remaining = n;
    return new IteratorHelper<T>(function () {
      if (remaining <= 0) return { done: true, value: undefined as any };
      remaining--;
      return self.next();
    });
  }
  drop(n: number): IteratorHelper<T> {
    const self = this;
    let remaining = n;
    return new IteratorHelper<T>(function () {
      while (remaining > 0) {
        const r = self.next();
        if (r.done) return { done: true, value: undefined as any };
        remaining--;
      }
      return self.next();
    });
  }
  forEach(cb: (v: T) => void): void {
    while (true) {
      const r = this.next();
      if (r.done) return;
      cb(r.value);
    }
  }
  toArray(): T[] {
    const out: T[] = [];
    while (true) {
      const r = this.next();
      if (r.done) return out;
      out.push(r.value);
    }
  }
}

if (typeof (Iterator.prototype as any).map !== "function") {
  Object.defineProperty(Iterator.prototype, "map", {
    value: function <T, U>(this: Iterator<T>, f: (v: T) => U) {
      const it = this;
      return new IteratorHelper<U>(function () {
        const r = it.next();
        if (r.done) return { done: true, value: undefined as any };
        return { done: false, value: f(r.value) };
      });
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
if (typeof (Iterator.prototype as any).filter !== "function") {
  Object.defineProperty(Iterator.prototype, "filter", {
    value: function <T>(this: Iterator<T>, pred: (v: T) => boolean) {
      const it = this;
      return new IteratorHelper<T>(function () {
        while (true) {
          const r = it.next();
          if (r.done) return { done: true, value: undefined as any };
          if (pred(r.value)) return { done: false, value: r.value };
        }
      });
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
if (typeof (Iterator.prototype as any).take !== "function") {
  Object.defineProperty(Iterator.prototype, "take", {
    value: function <T>(this: Iterator<T>, n: number) {
      const it = this;
      let remaining = n;
      return new IteratorHelper<T>(function () {
        if (remaining <= 0) return { done: true, value: undefined as any };
        remaining--;
        return it.next();
      });
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
if (typeof (Iterator.prototype as any).drop !== "function") {
  Object.defineProperty(Iterator.prototype, "drop", {
    value: function <T>(this: Iterator<T>, n: number) {
      const it = this;
      let remaining = n;
      return new IteratorHelper<T>(function () {
        while (remaining > 0) {
          const r = it.next();
          if (r.done) return { done: true, value: undefined as any };
          remaining--;
        }
        return it.next();
      });
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
if (typeof (Iterator.prototype as any).forEach !== "function") {
  Object.defineProperty(Iterator.prototype, "forEach", {
    value: function <T>(this: Iterator<T>, cb: (v: T) => void) {
      while (true) {
        const r = this.next();
        if (r.done) return;
        cb(r.value);
      }
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
if (typeof (Iterator.prototype as any).toArray !== "function") {
  Object.defineProperty(Iterator.prototype, "toArray", {
    value: function <T>(this: Iterator<T>): T[] {
      const out: T[] = [];
      while (true) {
        const r = this.next();
        if (r.done) return out;
        out.push(r.value);
      }
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

// Export an empty object so this file is treated as a module by TS
// (it has side effects only — the polyfills above mutate globals).
export {};
