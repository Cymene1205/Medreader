/**
 * ES2025 / Stage-3 API polyfills for older browsers — used by pdfjs-dist v6.
 *
 * This file MUST be loaded synchronously in <head> BEFORE any client
 * JS bundle runs. See src/app/layout.tsx where it is referenced via
 * <script src="/polyfills.js"></script>.
 *
 * Why: pdfjs-dist v6.1.200 uses Math.sumPrecise, Map.prototype.getOrInsertComputed,
 * and Iterator helpers — all Stage-3 TC39 proposals that only landed in
 * Chrome 137+ (April 2025). On older browsers pdfjs throws
 *   TypeError: Math.sumPrecise is not a function
 * and PDF rendering silently fails with a blank canvas.
 */
(function () {
  "use strict";

  // ── Math.sumPrecise ────────────────────────────────────────────────
  // Spec: https://github.com/tc39/proposal-math-sum
  // Returns the sum of an iterable of Numbers with reduced FP error
  // (Neumaier variant of Kahan summation — good enough for pdfjs's
  // page-positioning math; not arbitrary precision but spec-compliant
  // for finite inputs).
  if (typeof Math.sumPrecise !== "function") {
    Object.defineProperty(Math, "sumPrecise", {
      value: function sumPrecise(items) {
        if (items == null) {
          throw new TypeError("Cannot convert undefined or null to object");
        }
        var sum = 0;
        var c = 0; // compensation
        var count = 0;
        var iter = items[Symbol.iterator]();
        var step;
        while (!(step = iter.next()).done) {
          var x = step.value;
          count++;
          if (typeof x !== "number" || !Number.isFinite(x)) {
            throw new TypeError(
              "Math.sumPrecise requires finite numbers, got: " + typeof x + " " + x
            );
          }
          var t = sum + x;
          if (Math.abs(sum) >= Math.abs(x)) {
            c += sum - t + x;
          } else {
            c += x - t + sum;
          }
          sum = t;
        }
        if (count === 0) return 0;
        return sum + c;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  // ── Map.prototype.getOrInsertComputed ──────────────────────────────
  // Spec: https://github.com/tc39/proposal-upsert
  // If key is present, return its value. Otherwise call factory(key),
  // insert the result, and return it.
  if (typeof Map.prototype.getOrInsertComputed !== "function") {
    Object.defineProperty(Map.prototype, "getOrInsertComputed", {
      value: function getOrInsertComputed(key, factory) {
        if (this.has(key)) return this.get(key);
        if (typeof factory !== "function") {
          throw new TypeError("factory must be a function");
        }
        var value = factory(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  // ── Map.prototype.getOrInsert (companion, sometimes also used) ─────
  if (typeof Map.prototype.getOrInsert !== "function") {
    Object.defineProperty(Map.prototype, "getOrInsert", {
      value: function getOrInsert(key, value) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  // ── Iterator helpers ───────────────────────────────────────────────
  // Spec: https://github.com/tc39/proposal-iterator-helpers
  // Polyfill .map / .filter / .take / .drop / .forEach / .toArray on
  // Iterator.prototype. Returns a wrapped iterator that lazily applies
  // the transformation.
  if (typeof Iterator === "undefined") {
    // Very old browsers — skip; pdfjs requires modern JS anyway.
    return;
  }

  function makeHelper(nextFn) {
    var helper = { next: nextFn };
    helper[Symbol.iterator] = function () { return helper; };
    // Also expose chainable helpers on the wrapper.
    helper.map = function (f) {
      var self = helper;
      return makeHelper(function () {
        var r = self.next();
        if (r.done) return { done: true, value: undefined };
        return { done: false, value: f(r.value) };
      });
    };
    helper.filter = function (pred) {
      var self = helper;
      return makeHelper(function () {
        while (true) {
          var r = self.next();
          if (r.done) return { done: true, value: undefined };
          if (pred(r.value)) return { done: false, value: r.value };
        }
      });
    };
    helper.take = function (n) {
      var self = helper;
      var remaining = n;
      return makeHelper(function () {
        if (remaining <= 0) return { done: true, value: undefined };
        remaining--;
        return self.next();
      });
    };
    helper.drop = function (n) {
      var self = helper;
      var remaining = n;
      return makeHelper(function () {
        while (remaining > 0) {
          var r = self.next();
          if (r.done) return { done: true, value: undefined };
          remaining--;
        }
        return self.next();
      });
    };
    helper.forEach = function (cb) {
      while (true) {
        var r = helper.next();
        if (r.done) return;
        cb(r.value);
      }
    };
    helper.toArray = function () {
      var out = [];
      while (true) {
        var r = helper.next();
        if (r.done) return out;
        out.push(r.value);
      }
    };
    return helper;
  }

  if (typeof Iterator.prototype.map !== "function") {
    Object.defineProperty(Iterator.prototype, "map", {
      value: function (f) {
        var it = this;
        return makeHelper(function () {
          var r = it.next();
          if (r.done) return { done: true, value: undefined };
          return { done: false, value: f(r.value) };
        });
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  if (typeof Iterator.prototype.filter !== "function") {
    Object.defineProperty(Iterator.prototype, "filter", {
      value: function (pred) {
        var it = this;
        return makeHelper(function () {
          while (true) {
            var r = it.next();
            if (r.done) return { done: true, value: undefined };
            if (pred(r.value)) return { done: false, value: r.value };
          }
        });
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  if (typeof Iterator.prototype.take !== "function") {
    Object.defineProperty(Iterator.prototype, "take", {
      value: function (n) {
        var it = this;
        var remaining = n;
        return makeHelper(function () {
          if (remaining <= 0) return { done: true, value: undefined };
          remaining--;
          return it.next();
        });
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  if (typeof Iterator.prototype.drop !== "function") {
    Object.defineProperty(Iterator.prototype, "drop", {
      value: function (n) {
        var it = this;
        var remaining = n;
        return makeHelper(function () {
          while (remaining > 0) {
            var r = it.next();
            if (r.done) return { done: true, value: undefined };
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
  if (typeof Iterator.prototype.forEach !== "function") {
    Object.defineProperty(Iterator.prototype, "forEach", {
      value: function (cb) {
        while (true) {
          var r = this.next();
          if (r.done) return;
          cb(r.value);
        }
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  if (typeof Iterator.prototype.toArray !== "function") {
    Object.defineProperty(Iterator.prototype, "toArray", {
      value: function () {
        var out = [];
        while (true) {
          var r = this.next();
          if (r.done) return out;
          out.push(r.value);
        }
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
})();
