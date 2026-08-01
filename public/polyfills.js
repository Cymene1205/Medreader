/**
 * ES2025 / Stage-3 API polyfills for older browsers — used by pdfjs-dist v6.
 *
 * This file MUST be loaded synchronously in <head> BEFORE any client
 * JS bundle runs. See src/app/layout.tsx where it is referenced via
 * <script src="/polyfills.js"></script>.
 *
 * Why: pdfjs-dist v6.1.200 uses Math.sumPrecise, Map.prototype.getOrInsertComputed,
 * Uint8Array.prototype.toHex, and Iterator helpers — all Stage-3 TC39 proposals
 * that only landed in Chrome 137+ (April 2025) / Chrome 140+ (toHex, July 2025).
 * On older browsers (notably WeChat in-app browser X5 kernel, Edge legacy,
 * Safari < 18.2) pdfjs throws:
 *   TypeError: Math.sumPrecise is not a function
 *   TypeError: a.toHex is not a function
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

  // ── Uint8Array.prototype.toHex ─────────────────────────────────────
  // Spec: https://github.com/tc39/proposal-arraybuffer-base64
  // Returns a hex string representation of the byte array.
  // Used by pdfjs v6 internally for color/hex conversions and crypto
  // fingerprints. Throws "a.toHex is not a function" without this on
  // WeChat X5 / older Chromium.
  if (typeof Uint8Array.prototype.toHex !== "function") {
    Object.defineProperty(Uint8Array.prototype, "toHex", {
      value: function toHex() {
        var len = this.length;
        var out = "";
        for (var i = 0; i < len; i++) {
          var b = this[i] & 0xff;
          out += (b < 16 ? "0" : "") + b.toString(16);
        }
        return out;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  // ── Uint8Array.fromHex (static) ───────────────────────────────────
  // Spec: https://github.com/tc39/proposal-arraybuffer-base64
  // Parses a hex string into a new Uint8Array.
  if (typeof Uint8Array.fromHex !== "function") {
    Object.defineProperty(Uint8Array, "fromHex", {
      value: function fromHex(hex) {
        if (typeof hex !== "string") {
          throw new TypeError("Uint8Array.fromHex requires a string");
        }
        if (hex.length % 2 !== 0) {
          throw new SyntaxError(
            "Uint8Array.fromHex requires an even-length string"
          );
        }
        var len = hex.length / 2;
        var out = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
          var hi = hex.charCodeAt(i * 2);
          var lo = hex.charCodeAt(i * 2 + 1);
          var h = (hi >= 48 && hi <= 57) ? hi - 48
                : (hi >= 65 && hi <= 70) ? hi - 55
                : (hi >= 97 && hi <= 102) ? hi - 87
                : -1;
          var l = (lo >= 48 && lo <= 57) ? lo - 48
                : (lo >= 65 && lo <= 70) ? lo - 55
                : (lo >= 97 && lo <= 102) ? lo - 87
                : -1;
          if (h < 0 || l < 0) {
            throw new SyntaxError(
              "Uint8Array.fromHex encountered non-hex character at index " + (i * 2)
            );
          }
          out[i] = (h << 4) | l;
        }
        return out;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  // ── Uint8Array.prototype.toBase64 ─────────────────────────────────
  // Spec: same proposal as toHex. pdfjs v6 also uses this in some paths.
  // Minimal polyfill (standard alphabet, padded).
  if (typeof Uint8Array.prototype.toBase64 !== "function") {
    var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    Object.defineProperty(Uint8Array.prototype, "toBase64", {
      value: function toBase64() {
        var len = this.length;
        if (len === 0) return "";
        var out = "";
        var i = 0;
        for (; i + 2 < len; i += 3) {
          var b0 = this[i] & 0xff;
          var b1 = this[i + 1] & 0xff;
          var b2 = this[i + 2] & 0xff;
          out += B64_CHARS[b0 >> 2];
          out += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
          out += B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)];
          out += B64_CHARS[b2 & 63];
        }
        if (i < len) {
          var r0 = this[i] & 0xff;
          out += B64_CHARS[r0 >> 2];
          if (i + 1 < len) {
            var r1 = this[i + 1] & 0xff;
            out += B64_CHARS[((r0 & 3) << 4) | (r1 >> 4)];
            out += B64_CHARS[(r1 & 15) << 2];
            out += "=";
          } else {
            out += B64_CHARS[(r0 & 3) << 4];
            out += "==";
          }
        }
        return out;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  // ── Uint8Array.fromBase64 (static) ────────────────────────────────
  if (typeof Uint8Array.fromBase64 !== "function") {
    var B64_LOOKUP = (function () {
      var m = new Int8Array(256);
      for (var i = 0; i < 256; i++) m[i] = -1;
      for (var j = 0; j < B64_CHARS.length; j++) {
        m[B64_CHARS.charCodeAt(j)] = j;
      }
      return m;
    })();
    Object.defineProperty(Uint8Array, "fromBase64", {
      value: function fromBase64(b64) {
        if (typeof b64 !== "string") {
          throw new TypeError("Uint8Array.fromBase64 requires a string");
        }
        var clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
        var padLen = clean.endsWith("==") ? 2 : (clean.endsWith("=") ? 1 : 0);
        var len = (clean.length * 3) / 4 - padLen;
        var out = new Uint8Array(len);
        var idx = 0;
        for (var i = 0; i < clean.length; i += 4) {
          var c0 = B64_LOOKUP[clean.charCodeAt(i)];
          var c1 = B64_LOOKUP[clean.charCodeAt(i + 1)];
          var c2 = clean.charCodeAt(i + 2) === 61 ? 0 : B64_LOOKUP[clean.charCodeAt(i + 2)];
          var c3 = clean.charCodeAt(i + 3) === 61 ? 0 : B64_LOOKUP[clean.charCodeAt(i + 3)];
          if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) {
            throw new SyntaxError("Uint8Array.fromBase64: invalid character");
          }
          var n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
          if (idx < len) out[idx++] = (n >> 16) & 0xff;
          if (idx < len) out[idx++] = (n >> 8) & 0xff;
          if (idx < len) out[idx++] = n & 0xff;
        }
        return out;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  // ── Map.prototype.getOrInsertComputed ──────────────────────────────
  // Spec: https://github.com/tc39/proposal-upsert
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

  // ── Map.prototype.getOrInsert (companion) ──────────────────────────
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
  if (typeof Iterator === "undefined") {
    return;
  }

  function makeHelper(nextFn) {
    var helper = { next: nextFn };
    helper[Symbol.iterator] = function () { return helper; };
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
