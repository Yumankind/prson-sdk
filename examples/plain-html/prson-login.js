var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@stablelib/random/lib/source/browser.js
var require_browser = __commonJS({
  "node_modules/@stablelib/random/lib/source/browser.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BrowserRandomSource = void 0;
    var QUOTA = 65536;
    var BrowserRandomSource = class {
      constructor() {
        this.isAvailable = false;
        this.isInstantiated = false;
        const browserCrypto = typeof self !== "undefined" ? self.crypto || self.msCrypto : null;
        if (browserCrypto && browserCrypto.getRandomValues !== void 0) {
          this._crypto = browserCrypto;
          this.isAvailable = true;
          this.isInstantiated = true;
        }
      }
      randomBytes(length) {
        if (!this.isAvailable || !this._crypto) {
          throw new Error("Browser random byte generator is not available.");
        }
        const out = new Uint8Array(length);
        for (let i = 0; i < out.length; i += QUOTA) {
          this._crypto.getRandomValues(out.subarray(i, i + Math.min(out.length - i, QUOTA)));
        }
        return out;
      }
    };
    exports.BrowserRandomSource = BrowserRandomSource;
  }
});

// node_modules/@stablelib/wipe/lib/wipe.js
var require_wipe = __commonJS({
  "node_modules/@stablelib/wipe/lib/wipe.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function wipe(array) {
      for (var i = 0; i < array.length; i++) {
        array[i] = 0;
      }
      return array;
    }
    exports.wipe = wipe;
  }
});

// (disabled):crypto
var require_crypto = __commonJS({
  "(disabled):crypto"() {
  }
});

// node_modules/@stablelib/random/lib/source/node.js
var require_node = __commonJS({
  "node_modules/@stablelib/random/lib/source/node.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NodeRandomSource = void 0;
    var wipe_1 = require_wipe();
    var NodeRandomSource = class {
      constructor() {
        this.isAvailable = false;
        this.isInstantiated = false;
        if (typeof __require !== "undefined") {
          const nodeCrypto = require_crypto();
          if (nodeCrypto && nodeCrypto.randomBytes) {
            this._crypto = nodeCrypto;
            this.isAvailable = true;
            this.isInstantiated = true;
          }
        }
      }
      randomBytes(length) {
        if (!this.isAvailable || !this._crypto) {
          throw new Error("Node.js random byte generator is not available.");
        }
        let buffer = this._crypto.randomBytes(length);
        if (buffer.length !== length) {
          throw new Error("NodeRandomSource: got fewer bytes than requested");
        }
        const out = new Uint8Array(length);
        for (let i = 0; i < out.length; i++) {
          out[i] = buffer[i];
        }
        (0, wipe_1.wipe)(buffer);
        return out;
      }
    };
    exports.NodeRandomSource = NodeRandomSource;
  }
});

// node_modules/@stablelib/random/lib/source/system.js
var require_system = __commonJS({
  "node_modules/@stablelib/random/lib/source/system.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SystemRandomSource = void 0;
    var browser_1 = require_browser();
    var node_1 = require_node();
    var SystemRandomSource = class {
      constructor() {
        this.isAvailable = false;
        this.name = "";
        this._source = new browser_1.BrowserRandomSource();
        if (this._source.isAvailable) {
          this.isAvailable = true;
          this.name = "Browser";
          return;
        }
        this._source = new node_1.NodeRandomSource();
        if (this._source.isAvailable) {
          this.isAvailable = true;
          this.name = "Node";
          return;
        }
      }
      randomBytes(length) {
        if (!this.isAvailable) {
          throw new Error("System random byte generator is not available.");
        }
        return this._source.randomBytes(length);
      }
    };
    exports.SystemRandomSource = SystemRandomSource;
  }
});

// node_modules/@stablelib/int/lib/int.js
var require_int = __commonJS({
  "node_modules/@stablelib/int/lib/int.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function imulShim(a, b) {
      var ah = a >>> 16 & 65535, al = a & 65535;
      var bh = b >>> 16 & 65535, bl = b & 65535;
      return al * bl + (ah * bl + al * bh << 16 >>> 0) | 0;
    }
    exports.mul = Math.imul || imulShim;
    function add(a, b) {
      return a + b | 0;
    }
    exports.add = add;
    function sub(a, b) {
      return a - b | 0;
    }
    exports.sub = sub;
    function rotl(x, n) {
      return x << n | x >>> 32 - n;
    }
    exports.rotl = rotl;
    function rotr(x, n) {
      return x << 32 - n | x >>> n;
    }
    exports.rotr = rotr;
    function isIntegerShim(n) {
      return typeof n === "number" && isFinite(n) && Math.floor(n) === n;
    }
    exports.isInteger = Number.isInteger || isIntegerShim;
    exports.MAX_SAFE_INTEGER = 9007199254740991;
    exports.isSafeInteger = function(n) {
      return exports.isInteger(n) && (n >= -exports.MAX_SAFE_INTEGER && n <= exports.MAX_SAFE_INTEGER);
    };
  }
});

// node_modules/@stablelib/binary/lib/binary.js
var require_binary = __commonJS({
  "node_modules/@stablelib/binary/lib/binary.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var int_1 = require_int();
    function readInt16BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 0] << 8 | array[offset + 1]) << 16 >> 16;
    }
    exports.readInt16BE = readInt16BE;
    function readUint16BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 0] << 8 | array[offset + 1]) >>> 0;
    }
    exports.readUint16BE = readUint16BE;
    function readInt16LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 1] << 8 | array[offset]) << 16 >> 16;
    }
    exports.readInt16LE = readInt16LE;
    function readUint16LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 1] << 8 | array[offset]) >>> 0;
    }
    exports.readUint16LE = readUint16LE;
    function writeUint16BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(2);
      }
      if (offset === void 0) {
        offset = 0;
      }
      out[offset + 0] = value >>> 8;
      out[offset + 1] = value >>> 0;
      return out;
    }
    exports.writeUint16BE = writeUint16BE;
    exports.writeInt16BE = writeUint16BE;
    function writeUint16LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(2);
      }
      if (offset === void 0) {
        offset = 0;
      }
      out[offset + 0] = value >>> 0;
      out[offset + 1] = value >>> 8;
      return out;
    }
    exports.writeUint16LE = writeUint16LE;
    exports.writeInt16LE = writeUint16LE;
    function readInt32BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return array[offset] << 24 | array[offset + 1] << 16 | array[offset + 2] << 8 | array[offset + 3];
    }
    exports.readInt32BE = readInt32BE;
    function readUint32BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset] << 24 | array[offset + 1] << 16 | array[offset + 2] << 8 | array[offset + 3]) >>> 0;
    }
    exports.readUint32BE = readUint32BE;
    function readInt32LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return array[offset + 3] << 24 | array[offset + 2] << 16 | array[offset + 1] << 8 | array[offset];
    }
    exports.readInt32LE = readInt32LE;
    function readUint32LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      return (array[offset + 3] << 24 | array[offset + 2] << 16 | array[offset + 1] << 8 | array[offset]) >>> 0;
    }
    exports.readUint32LE = readUint32LE;
    function writeUint32BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(4);
      }
      if (offset === void 0) {
        offset = 0;
      }
      out[offset + 0] = value >>> 24;
      out[offset + 1] = value >>> 16;
      out[offset + 2] = value >>> 8;
      out[offset + 3] = value >>> 0;
      return out;
    }
    exports.writeUint32BE = writeUint32BE;
    exports.writeInt32BE = writeUint32BE;
    function writeUint32LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(4);
      }
      if (offset === void 0) {
        offset = 0;
      }
      out[offset + 0] = value >>> 0;
      out[offset + 1] = value >>> 8;
      out[offset + 2] = value >>> 16;
      out[offset + 3] = value >>> 24;
      return out;
    }
    exports.writeUint32LE = writeUint32LE;
    exports.writeInt32LE = writeUint32LE;
    function readInt64BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var hi = readInt32BE(array, offset);
      var lo = readInt32BE(array, offset + 4);
      return hi * 4294967296 + lo - (lo >> 31) * 4294967296;
    }
    exports.readInt64BE = readInt64BE;
    function readUint64BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var hi = readUint32BE(array, offset);
      var lo = readUint32BE(array, offset + 4);
      return hi * 4294967296 + lo;
    }
    exports.readUint64BE = readUint64BE;
    function readInt64LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var lo = readInt32LE(array, offset);
      var hi = readInt32LE(array, offset + 4);
      return hi * 4294967296 + lo - (lo >> 31) * 4294967296;
    }
    exports.readInt64LE = readInt64LE;
    function readUint64LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var lo = readUint32LE(array, offset);
      var hi = readUint32LE(array, offset + 4);
      return hi * 4294967296 + lo;
    }
    exports.readUint64LE = readUint64LE;
    function writeUint64BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      writeUint32BE(value / 4294967296 >>> 0, out, offset);
      writeUint32BE(value >>> 0, out, offset + 4);
      return out;
    }
    exports.writeUint64BE = writeUint64BE;
    exports.writeInt64BE = writeUint64BE;
    function writeUint64LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      writeUint32LE(value >>> 0, out, offset);
      writeUint32LE(value / 4294967296 >>> 0, out, offset + 4);
      return out;
    }
    exports.writeUint64LE = writeUint64LE;
    exports.writeInt64LE = writeUint64LE;
    function readUintBE(bitLength, array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      if (bitLength % 8 !== 0) {
        throw new Error("readUintBE supports only bitLengths divisible by 8");
      }
      if (bitLength / 8 > array.length - offset) {
        throw new Error("readUintBE: array is too short for the given bitLength");
      }
      var result = 0;
      var mul = 1;
      for (var i = bitLength / 8 + offset - 1; i >= offset; i--) {
        result += array[i] * mul;
        mul *= 256;
      }
      return result;
    }
    exports.readUintBE = readUintBE;
    function readUintLE(bitLength, array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      if (bitLength % 8 !== 0) {
        throw new Error("readUintLE supports only bitLengths divisible by 8");
      }
      if (bitLength / 8 > array.length - offset) {
        throw new Error("readUintLE: array is too short for the given bitLength");
      }
      var result = 0;
      var mul = 1;
      for (var i = offset; i < offset + bitLength / 8; i++) {
        result += array[i] * mul;
        mul *= 256;
      }
      return result;
    }
    exports.readUintLE = readUintLE;
    function writeUintBE(bitLength, value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(bitLength / 8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      if (bitLength % 8 !== 0) {
        throw new Error("writeUintBE supports only bitLengths divisible by 8");
      }
      if (!int_1.isSafeInteger(value)) {
        throw new Error("writeUintBE value must be an integer");
      }
      var div = 1;
      for (var i = bitLength / 8 + offset - 1; i >= offset; i--) {
        out[i] = value / div & 255;
        div *= 256;
      }
      return out;
    }
    exports.writeUintBE = writeUintBE;
    function writeUintLE(bitLength, value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(bitLength / 8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      if (bitLength % 8 !== 0) {
        throw new Error("writeUintLE supports only bitLengths divisible by 8");
      }
      if (!int_1.isSafeInteger(value)) {
        throw new Error("writeUintLE value must be an integer");
      }
      var div = 1;
      for (var i = offset; i < offset + bitLength / 8; i++) {
        out[i] = value / div & 255;
        div *= 256;
      }
      return out;
    }
    exports.writeUintLE = writeUintLE;
    function readFloat32BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      return view.getFloat32(offset);
    }
    exports.readFloat32BE = readFloat32BE;
    function readFloat32LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      return view.getFloat32(offset, true);
    }
    exports.readFloat32LE = readFloat32LE;
    function readFloat64BE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      return view.getFloat64(offset);
    }
    exports.readFloat64BE = readFloat64BE;
    function readFloat64LE(array, offset) {
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      return view.getFloat64(offset, true);
    }
    exports.readFloat64LE = readFloat64LE;
    function writeFloat32BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(4);
      }
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      view.setFloat32(offset, value);
      return out;
    }
    exports.writeFloat32BE = writeFloat32BE;
    function writeFloat32LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(4);
      }
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      view.setFloat32(offset, value, true);
      return out;
    }
    exports.writeFloat32LE = writeFloat32LE;
    function writeFloat64BE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      view.setFloat64(offset, value);
      return out;
    }
    exports.writeFloat64BE = writeFloat64BE;
    function writeFloat64LE(value, out, offset) {
      if (out === void 0) {
        out = new Uint8Array(8);
      }
      if (offset === void 0) {
        offset = 0;
      }
      var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      view.setFloat64(offset, value, true);
      return out;
    }
    exports.writeFloat64LE = writeFloat64LE;
  }
});

// node_modules/@stablelib/random/lib/random.js
var require_random = __commonJS({
  "node_modules/@stablelib/random/lib/random.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.randomStringForEntropy = exports.randomString = exports.randomUint32 = exports.randomBytes = exports.defaultRandomSource = void 0;
    var system_1 = require_system();
    var binary_1 = require_binary();
    var wipe_1 = require_wipe();
    exports.defaultRandomSource = new system_1.SystemRandomSource();
    function randomBytes2(length, prng = exports.defaultRandomSource) {
      return prng.randomBytes(length);
    }
    exports.randomBytes = randomBytes2;
    function randomUint32(prng = exports.defaultRandomSource) {
      const buf = randomBytes2(4, prng);
      const result = (0, binary_1.readUint32LE)(buf);
      (0, wipe_1.wipe)(buf);
      return result;
    }
    exports.randomUint32 = randomUint32;
    var ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    function randomString(length, charset = ALPHANUMERIC, prng = exports.defaultRandomSource) {
      if (charset.length < 2) {
        throw new Error("randomString charset is too short");
      }
      if (charset.length > 256) {
        throw new Error("randomString charset is too long");
      }
      let out = "";
      const charsLen = charset.length;
      const maxByte = 256 - 256 % charsLen;
      while (length > 0) {
        const buf = randomBytes2(Math.ceil(length * 256 / maxByte), prng);
        for (let i = 0; i < buf.length && length > 0; i++) {
          const randomByte = buf[i];
          if (randomByte < maxByte) {
            out += charset.charAt(randomByte % charsLen);
            length--;
          }
        }
        (0, wipe_1.wipe)(buf);
      }
      return out;
    }
    exports.randomString = randomString;
    function randomStringForEntropy(bits, charset = ALPHANUMERIC, prng = exports.defaultRandomSource) {
      const length = Math.ceil(bits / (Math.log(charset.length) / Math.LN2));
      return randomString(length, charset, prng);
    }
    exports.randomStringForEntropy = randomStringForEntropy;
  }
});

// node_modules/@stablelib/x25519/lib/x25519.js
var require_x25519 = __commonJS({
  "node_modules/@stablelib/x25519/lib/x25519.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sharedKey = exports.generateKeyPair = exports.generateKeyPairFromSeed = exports.scalarMultBase = exports.scalarMult = exports.SHARED_KEY_LENGTH = exports.SECRET_KEY_LENGTH = exports.PUBLIC_KEY_LENGTH = void 0;
    var random_1 = require_random();
    var wipe_1 = require_wipe();
    exports.PUBLIC_KEY_LENGTH = 32;
    exports.SECRET_KEY_LENGTH = 32;
    exports.SHARED_KEY_LENGTH = 32;
    function gf(init) {
      const r = new Float64Array(16);
      if (init) {
        for (let i = 0; i < init.length; i++) {
          r[i] = init[i];
        }
      }
      return r;
    }
    var _9 = new Uint8Array(32);
    _9[0] = 9;
    var _121665 = gf([56129, 1]);
    function car25519(o) {
      let c = 1;
      for (let i = 0; i < 16; i++) {
        let v = o[i] + c + 65535;
        c = Math.floor(v / 65536);
        o[i] = v - c * 65536;
      }
      o[0] += c - 1 + 37 * (c - 1);
    }
    function sel25519(p, q, b) {
      const c = ~(b - 1);
      for (let i = 0; i < 16; i++) {
        const t = c & (p[i] ^ q[i]);
        p[i] ^= t;
        q[i] ^= t;
      }
    }
    function pack25519(o, n) {
      const m = gf();
      const t = gf();
      for (let i = 0; i < 16; i++) {
        t[i] = n[i];
      }
      car25519(t);
      car25519(t);
      car25519(t);
      for (let j = 0; j < 2; j++) {
        m[0] = t[0] - 65517;
        for (let i = 1; i < 15; i++) {
          m[i] = t[i] - 65535 - (m[i - 1] >> 16 & 1);
          m[i - 1] &= 65535;
        }
        m[15] = t[15] - 32767 - (m[14] >> 16 & 1);
        const b = m[15] >> 16 & 1;
        m[14] &= 65535;
        sel25519(t, m, 1 - b);
      }
      for (let i = 0; i < 16; i++) {
        o[2 * i] = t[i] & 255;
        o[2 * i + 1] = t[i] >> 8;
      }
    }
    function unpack25519(o, n) {
      for (let i = 0; i < 16; i++) {
        o[i] = n[2 * i] + (n[2 * i + 1] << 8);
      }
      o[15] &= 32767;
    }
    function add(o, a, b) {
      for (let i = 0; i < 16; i++) {
        o[i] = a[i] + b[i];
      }
    }
    function sub(o, a, b) {
      for (let i = 0; i < 16; i++) {
        o[i] = a[i] - b[i];
      }
    }
    function mul(o, a, b) {
      let v, c, t0 = 0, t1 = 0, t2 = 0, t3 = 0, t4 = 0, t5 = 0, t6 = 0, t7 = 0, t8 = 0, t9 = 0, t10 = 0, t11 = 0, t12 = 0, t13 = 0, t14 = 0, t15 = 0, t16 = 0, t17 = 0, t18 = 0, t19 = 0, t20 = 0, t21 = 0, t22 = 0, t23 = 0, t24 = 0, t25 = 0, t26 = 0, t27 = 0, t28 = 0, t29 = 0, t30 = 0, b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11], b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
      v = a[0];
      t0 += v * b0;
      t1 += v * b1;
      t2 += v * b2;
      t3 += v * b3;
      t4 += v * b4;
      t5 += v * b5;
      t6 += v * b6;
      t7 += v * b7;
      t8 += v * b8;
      t9 += v * b9;
      t10 += v * b10;
      t11 += v * b11;
      t12 += v * b12;
      t13 += v * b13;
      t14 += v * b14;
      t15 += v * b15;
      v = a[1];
      t1 += v * b0;
      t2 += v * b1;
      t3 += v * b2;
      t4 += v * b3;
      t5 += v * b4;
      t6 += v * b5;
      t7 += v * b6;
      t8 += v * b7;
      t9 += v * b8;
      t10 += v * b9;
      t11 += v * b10;
      t12 += v * b11;
      t13 += v * b12;
      t14 += v * b13;
      t15 += v * b14;
      t16 += v * b15;
      v = a[2];
      t2 += v * b0;
      t3 += v * b1;
      t4 += v * b2;
      t5 += v * b3;
      t6 += v * b4;
      t7 += v * b5;
      t8 += v * b6;
      t9 += v * b7;
      t10 += v * b8;
      t11 += v * b9;
      t12 += v * b10;
      t13 += v * b11;
      t14 += v * b12;
      t15 += v * b13;
      t16 += v * b14;
      t17 += v * b15;
      v = a[3];
      t3 += v * b0;
      t4 += v * b1;
      t5 += v * b2;
      t6 += v * b3;
      t7 += v * b4;
      t8 += v * b5;
      t9 += v * b6;
      t10 += v * b7;
      t11 += v * b8;
      t12 += v * b9;
      t13 += v * b10;
      t14 += v * b11;
      t15 += v * b12;
      t16 += v * b13;
      t17 += v * b14;
      t18 += v * b15;
      v = a[4];
      t4 += v * b0;
      t5 += v * b1;
      t6 += v * b2;
      t7 += v * b3;
      t8 += v * b4;
      t9 += v * b5;
      t10 += v * b6;
      t11 += v * b7;
      t12 += v * b8;
      t13 += v * b9;
      t14 += v * b10;
      t15 += v * b11;
      t16 += v * b12;
      t17 += v * b13;
      t18 += v * b14;
      t19 += v * b15;
      v = a[5];
      t5 += v * b0;
      t6 += v * b1;
      t7 += v * b2;
      t8 += v * b3;
      t9 += v * b4;
      t10 += v * b5;
      t11 += v * b6;
      t12 += v * b7;
      t13 += v * b8;
      t14 += v * b9;
      t15 += v * b10;
      t16 += v * b11;
      t17 += v * b12;
      t18 += v * b13;
      t19 += v * b14;
      t20 += v * b15;
      v = a[6];
      t6 += v * b0;
      t7 += v * b1;
      t8 += v * b2;
      t9 += v * b3;
      t10 += v * b4;
      t11 += v * b5;
      t12 += v * b6;
      t13 += v * b7;
      t14 += v * b8;
      t15 += v * b9;
      t16 += v * b10;
      t17 += v * b11;
      t18 += v * b12;
      t19 += v * b13;
      t20 += v * b14;
      t21 += v * b15;
      v = a[7];
      t7 += v * b0;
      t8 += v * b1;
      t9 += v * b2;
      t10 += v * b3;
      t11 += v * b4;
      t12 += v * b5;
      t13 += v * b6;
      t14 += v * b7;
      t15 += v * b8;
      t16 += v * b9;
      t17 += v * b10;
      t18 += v * b11;
      t19 += v * b12;
      t20 += v * b13;
      t21 += v * b14;
      t22 += v * b15;
      v = a[8];
      t8 += v * b0;
      t9 += v * b1;
      t10 += v * b2;
      t11 += v * b3;
      t12 += v * b4;
      t13 += v * b5;
      t14 += v * b6;
      t15 += v * b7;
      t16 += v * b8;
      t17 += v * b9;
      t18 += v * b10;
      t19 += v * b11;
      t20 += v * b12;
      t21 += v * b13;
      t22 += v * b14;
      t23 += v * b15;
      v = a[9];
      t9 += v * b0;
      t10 += v * b1;
      t11 += v * b2;
      t12 += v * b3;
      t13 += v * b4;
      t14 += v * b5;
      t15 += v * b6;
      t16 += v * b7;
      t17 += v * b8;
      t18 += v * b9;
      t19 += v * b10;
      t20 += v * b11;
      t21 += v * b12;
      t22 += v * b13;
      t23 += v * b14;
      t24 += v * b15;
      v = a[10];
      t10 += v * b0;
      t11 += v * b1;
      t12 += v * b2;
      t13 += v * b3;
      t14 += v * b4;
      t15 += v * b5;
      t16 += v * b6;
      t17 += v * b7;
      t18 += v * b8;
      t19 += v * b9;
      t20 += v * b10;
      t21 += v * b11;
      t22 += v * b12;
      t23 += v * b13;
      t24 += v * b14;
      t25 += v * b15;
      v = a[11];
      t11 += v * b0;
      t12 += v * b1;
      t13 += v * b2;
      t14 += v * b3;
      t15 += v * b4;
      t16 += v * b5;
      t17 += v * b6;
      t18 += v * b7;
      t19 += v * b8;
      t20 += v * b9;
      t21 += v * b10;
      t22 += v * b11;
      t23 += v * b12;
      t24 += v * b13;
      t25 += v * b14;
      t26 += v * b15;
      v = a[12];
      t12 += v * b0;
      t13 += v * b1;
      t14 += v * b2;
      t15 += v * b3;
      t16 += v * b4;
      t17 += v * b5;
      t18 += v * b6;
      t19 += v * b7;
      t20 += v * b8;
      t21 += v * b9;
      t22 += v * b10;
      t23 += v * b11;
      t24 += v * b12;
      t25 += v * b13;
      t26 += v * b14;
      t27 += v * b15;
      v = a[13];
      t13 += v * b0;
      t14 += v * b1;
      t15 += v * b2;
      t16 += v * b3;
      t17 += v * b4;
      t18 += v * b5;
      t19 += v * b6;
      t20 += v * b7;
      t21 += v * b8;
      t22 += v * b9;
      t23 += v * b10;
      t24 += v * b11;
      t25 += v * b12;
      t26 += v * b13;
      t27 += v * b14;
      t28 += v * b15;
      v = a[14];
      t14 += v * b0;
      t15 += v * b1;
      t16 += v * b2;
      t17 += v * b3;
      t18 += v * b4;
      t19 += v * b5;
      t20 += v * b6;
      t21 += v * b7;
      t22 += v * b8;
      t23 += v * b9;
      t24 += v * b10;
      t25 += v * b11;
      t26 += v * b12;
      t27 += v * b13;
      t28 += v * b14;
      t29 += v * b15;
      v = a[15];
      t15 += v * b0;
      t16 += v * b1;
      t17 += v * b2;
      t18 += v * b3;
      t19 += v * b4;
      t20 += v * b5;
      t21 += v * b6;
      t22 += v * b7;
      t23 += v * b8;
      t24 += v * b9;
      t25 += v * b10;
      t26 += v * b11;
      t27 += v * b12;
      t28 += v * b13;
      t29 += v * b14;
      t30 += v * b15;
      t0 += 38 * t16;
      t1 += 38 * t17;
      t2 += 38 * t18;
      t3 += 38 * t19;
      t4 += 38 * t20;
      t5 += 38 * t21;
      t6 += 38 * t22;
      t7 += 38 * t23;
      t8 += 38 * t24;
      t9 += 38 * t25;
      t10 += 38 * t26;
      t11 += 38 * t27;
      t12 += 38 * t28;
      t13 += 38 * t29;
      t14 += 38 * t30;
      c = 1;
      v = t0 + c + 65535;
      c = Math.floor(v / 65536);
      t0 = v - c * 65536;
      v = t1 + c + 65535;
      c = Math.floor(v / 65536);
      t1 = v - c * 65536;
      v = t2 + c + 65535;
      c = Math.floor(v / 65536);
      t2 = v - c * 65536;
      v = t3 + c + 65535;
      c = Math.floor(v / 65536);
      t3 = v - c * 65536;
      v = t4 + c + 65535;
      c = Math.floor(v / 65536);
      t4 = v - c * 65536;
      v = t5 + c + 65535;
      c = Math.floor(v / 65536);
      t5 = v - c * 65536;
      v = t6 + c + 65535;
      c = Math.floor(v / 65536);
      t6 = v - c * 65536;
      v = t7 + c + 65535;
      c = Math.floor(v / 65536);
      t7 = v - c * 65536;
      v = t8 + c + 65535;
      c = Math.floor(v / 65536);
      t8 = v - c * 65536;
      v = t9 + c + 65535;
      c = Math.floor(v / 65536);
      t9 = v - c * 65536;
      v = t10 + c + 65535;
      c = Math.floor(v / 65536);
      t10 = v - c * 65536;
      v = t11 + c + 65535;
      c = Math.floor(v / 65536);
      t11 = v - c * 65536;
      v = t12 + c + 65535;
      c = Math.floor(v / 65536);
      t12 = v - c * 65536;
      v = t13 + c + 65535;
      c = Math.floor(v / 65536);
      t13 = v - c * 65536;
      v = t14 + c + 65535;
      c = Math.floor(v / 65536);
      t14 = v - c * 65536;
      v = t15 + c + 65535;
      c = Math.floor(v / 65536);
      t15 = v - c * 65536;
      t0 += c - 1 + 37 * (c - 1);
      c = 1;
      v = t0 + c + 65535;
      c = Math.floor(v / 65536);
      t0 = v - c * 65536;
      v = t1 + c + 65535;
      c = Math.floor(v / 65536);
      t1 = v - c * 65536;
      v = t2 + c + 65535;
      c = Math.floor(v / 65536);
      t2 = v - c * 65536;
      v = t3 + c + 65535;
      c = Math.floor(v / 65536);
      t3 = v - c * 65536;
      v = t4 + c + 65535;
      c = Math.floor(v / 65536);
      t4 = v - c * 65536;
      v = t5 + c + 65535;
      c = Math.floor(v / 65536);
      t5 = v - c * 65536;
      v = t6 + c + 65535;
      c = Math.floor(v / 65536);
      t6 = v - c * 65536;
      v = t7 + c + 65535;
      c = Math.floor(v / 65536);
      t7 = v - c * 65536;
      v = t8 + c + 65535;
      c = Math.floor(v / 65536);
      t8 = v - c * 65536;
      v = t9 + c + 65535;
      c = Math.floor(v / 65536);
      t9 = v - c * 65536;
      v = t10 + c + 65535;
      c = Math.floor(v / 65536);
      t10 = v - c * 65536;
      v = t11 + c + 65535;
      c = Math.floor(v / 65536);
      t11 = v - c * 65536;
      v = t12 + c + 65535;
      c = Math.floor(v / 65536);
      t12 = v - c * 65536;
      v = t13 + c + 65535;
      c = Math.floor(v / 65536);
      t13 = v - c * 65536;
      v = t14 + c + 65535;
      c = Math.floor(v / 65536);
      t14 = v - c * 65536;
      v = t15 + c + 65535;
      c = Math.floor(v / 65536);
      t15 = v - c * 65536;
      t0 += c - 1 + 37 * (c - 1);
      o[0] = t0;
      o[1] = t1;
      o[2] = t2;
      o[3] = t3;
      o[4] = t4;
      o[5] = t5;
      o[6] = t6;
      o[7] = t7;
      o[8] = t8;
      o[9] = t9;
      o[10] = t10;
      o[11] = t11;
      o[12] = t12;
      o[13] = t13;
      o[14] = t14;
      o[15] = t15;
    }
    function square(o, a) {
      mul(o, a, a);
    }
    function inv25519(o, inp) {
      const c = gf();
      for (let i = 0; i < 16; i++) {
        c[i] = inp[i];
      }
      for (let i = 253; i >= 0; i--) {
        square(c, c);
        if (i !== 2 && i !== 4) {
          mul(c, c, inp);
        }
      }
      for (let i = 0; i < 16; i++) {
        o[i] = c[i];
      }
    }
    function scalarMult(n, p) {
      const z = new Uint8Array(32);
      const x = new Float64Array(80);
      const a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf();
      for (let i = 0; i < 31; i++) {
        z[i] = n[i];
      }
      z[31] = n[31] & 127 | 64;
      z[0] &= 248;
      unpack25519(x, p);
      for (let i = 0; i < 16; i++) {
        b[i] = x[i];
      }
      a[0] = d[0] = 1;
      for (let i = 254; i >= 0; --i) {
        const r = z[i >>> 3] >>> (i & 7) & 1;
        sel25519(a, b, r);
        sel25519(c, d, r);
        add(e, a, c);
        sub(a, a, c);
        add(c, b, d);
        sub(b, b, d);
        square(d, e);
        square(f, a);
        mul(a, c, a);
        mul(c, b, e);
        add(e, a, c);
        sub(a, a, c);
        square(b, a);
        sub(c, d, f);
        mul(a, c, _121665);
        add(a, a, d);
        mul(c, c, a);
        mul(a, d, f);
        mul(d, b, x);
        square(b, e);
        sel25519(a, b, r);
        sel25519(c, d, r);
      }
      for (let i = 0; i < 16; i++) {
        x[i + 16] = a[i];
        x[i + 32] = c[i];
        x[i + 48] = b[i];
        x[i + 64] = d[i];
      }
      const x32 = x.subarray(32);
      const x16 = x.subarray(16);
      inv25519(x32, x32);
      mul(x16, x16, x32);
      const q = new Uint8Array(32);
      pack25519(q, x16);
      return q;
    }
    exports.scalarMult = scalarMult;
    function scalarMultBase(n) {
      return scalarMult(n, _9);
    }
    exports.scalarMultBase = scalarMultBase;
    function generateKeyPairFromSeed(seed) {
      if (seed.length !== exports.SECRET_KEY_LENGTH) {
        throw new Error(`x25519: seed must be ${exports.SECRET_KEY_LENGTH} bytes`);
      }
      const secretKey = new Uint8Array(seed);
      const publicKey = scalarMultBase(secretKey);
      return {
        publicKey,
        secretKey
      };
    }
    exports.generateKeyPairFromSeed = generateKeyPairFromSeed;
    function generateKeyPair2(prng) {
      const seed = (0, random_1.randomBytes)(32, prng);
      const result = generateKeyPairFromSeed(seed);
      (0, wipe_1.wipe)(seed);
      return result;
    }
    exports.generateKeyPair = generateKeyPair2;
    function sharedKey(mySecretKey, theirPublicKey, rejectZero = false) {
      if (mySecretKey.length !== exports.PUBLIC_KEY_LENGTH) {
        throw new Error("X25519: incorrect secret key length");
      }
      if (theirPublicKey.length !== exports.PUBLIC_KEY_LENGTH) {
        throw new Error("X25519: incorrect public key length");
      }
      const result = scalarMult(mySecretKey, theirPublicKey);
      if (rejectZero) {
        let zeros = 0;
        for (let i = 0; i < result.length; i++) {
          zeros |= result[i];
        }
        if (zeros === 0) {
          throw new Error("X25519: invalid shared key");
        }
      }
      return result;
    }
    exports.sharedKey = sharedKey;
  }
});

// node_modules/@stablelib/salsa20/lib/salsa20.js
var require_salsa20 = __commonJS({
  "node_modules/@stablelib/salsa20/lib/salsa20.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var binary_1 = require_binary();
    var wipe_1 = require_wipe();
    var ROUNDS = 20;
    function core(out, input, key) {
      var j0 = 1634760805;
      var j1 = key[3] << 24 | key[2] << 16 | key[1] << 8 | key[0];
      var j2 = key[7] << 24 | key[6] << 16 | key[5] << 8 | key[4];
      var j3 = key[11] << 24 | key[10] << 16 | key[9] << 8 | key[8];
      var j4 = key[15] << 24 | key[14] << 16 | key[13] << 8 | key[12];
      var j5 = 857760878;
      var j6 = input[3] << 24 | input[2] << 16 | input[1] << 8 | input[0];
      var j7 = input[7] << 24 | input[6] << 16 | input[5] << 8 | input[4];
      var j8 = input[11] << 24 | input[10] << 16 | input[9] << 8 | input[8];
      var j9 = input[15] << 24 | input[14] << 16 | input[13] << 8 | input[12];
      var j10 = 2036477234;
      var j11 = key[19] << 24 | key[18] << 16 | key[17] << 8 | key[16];
      var j12 = key[23] << 24 | key[22] << 16 | key[21] << 8 | key[20];
      var j13 = key[27] << 24 | key[26] << 16 | key[25] << 8 | key[24];
      var j14 = key[31] << 24 | key[30] << 16 | key[29] << 8 | key[28];
      var j15 = 1797285236;
      var x0 = j0;
      var x1 = j1;
      var x2 = j2;
      var x3 = j3;
      var x4 = j4;
      var x5 = j5;
      var x6 = j6;
      var x7 = j7;
      var x8 = j8;
      var x9 = j9;
      var x10 = j10;
      var x11 = j11;
      var x12 = j12;
      var x13 = j13;
      var x14 = j14;
      var x15 = j15;
      var u;
      for (var i = 0; i < ROUNDS; i += 2) {
        u = x0 + x12 | 0;
        x4 ^= u << 7 | u >>> 32 - 7;
        u = x4 + x0 | 0;
        x8 ^= u << 9 | u >>> 32 - 9;
        u = x8 + x4 | 0;
        x12 ^= u << 13 | u >>> 32 - 13;
        u = x12 + x8 | 0;
        x0 ^= u << 18 | u >>> 32 - 18;
        u = x5 + x1 | 0;
        x9 ^= u << 7 | u >>> 32 - 7;
        u = x9 + x5 | 0;
        x13 ^= u << 9 | u >>> 32 - 9;
        u = x13 + x9 | 0;
        x1 ^= u << 13 | u >>> 32 - 13;
        u = x1 + x13 | 0;
        x5 ^= u << 18 | u >>> 32 - 18;
        u = x10 + x6 | 0;
        x14 ^= u << 7 | u >>> 32 - 7;
        u = x14 + x10 | 0;
        x2 ^= u << 9 | u >>> 32 - 9;
        u = x2 + x14 | 0;
        x6 ^= u << 13 | u >>> 32 - 13;
        u = x6 + x2 | 0;
        x10 ^= u << 18 | u >>> 32 - 18;
        u = x15 + x11 | 0;
        x3 ^= u << 7 | u >>> 32 - 7;
        u = x3 + x15 | 0;
        x7 ^= u << 9 | u >>> 32 - 9;
        u = x7 + x3 | 0;
        x11 ^= u << 13 | u >>> 32 - 13;
        u = x11 + x7 | 0;
        x15 ^= u << 18 | u >>> 32 - 18;
        u = x0 + x3 | 0;
        x1 ^= u << 7 | u >>> 32 - 7;
        u = x1 + x0 | 0;
        x2 ^= u << 9 | u >>> 32 - 9;
        u = x2 + x1 | 0;
        x3 ^= u << 13 | u >>> 32 - 13;
        u = x3 + x2 | 0;
        x0 ^= u << 18 | u >>> 32 - 18;
        u = x5 + x4 | 0;
        x6 ^= u << 7 | u >>> 32 - 7;
        u = x6 + x5 | 0;
        x7 ^= u << 9 | u >>> 32 - 9;
        u = x7 + x6 | 0;
        x4 ^= u << 13 | u >>> 32 - 13;
        u = x4 + x7 | 0;
        x5 ^= u << 18 | u >>> 32 - 18;
        u = x10 + x9 | 0;
        x11 ^= u << 7 | u >>> 32 - 7;
        u = x11 + x10 | 0;
        x8 ^= u << 9 | u >>> 32 - 9;
        u = x8 + x11 | 0;
        x9 ^= u << 13 | u >>> 32 - 13;
        u = x9 + x8 | 0;
        x10 ^= u << 18 | u >>> 32 - 18;
        u = x15 + x14 | 0;
        x12 ^= u << 7 | u >>> 32 - 7;
        u = x12 + x15 | 0;
        x13 ^= u << 9 | u >>> 32 - 9;
        u = x13 + x12 | 0;
        x14 ^= u << 13 | u >>> 32 - 13;
        u = x14 + x13 | 0;
        x15 ^= u << 18 | u >>> 32 - 18;
      }
      binary_1.writeUint32LE(x0 + j0 | 0, out, 0);
      binary_1.writeUint32LE(x1 + j1 | 0, out, 4);
      binary_1.writeUint32LE(x2 + j2 | 0, out, 8);
      binary_1.writeUint32LE(x3 + j3 | 0, out, 12);
      binary_1.writeUint32LE(x4 + j4 | 0, out, 16);
      binary_1.writeUint32LE(x5 + j5 | 0, out, 20);
      binary_1.writeUint32LE(x6 + j6 | 0, out, 24);
      binary_1.writeUint32LE(x7 + j7 | 0, out, 28);
      binary_1.writeUint32LE(x8 + j8 | 0, out, 32);
      binary_1.writeUint32LE(x9 + j9 | 0, out, 36);
      binary_1.writeUint32LE(x10 + j10 | 0, out, 40);
      binary_1.writeUint32LE(x11 + j11 | 0, out, 44);
      binary_1.writeUint32LE(x12 + j12 | 0, out, 48);
      binary_1.writeUint32LE(x13 + j13 | 0, out, 52);
      binary_1.writeUint32LE(x14 + j14 | 0, out, 56);
      binary_1.writeUint32LE(x15 + j15 | 0, out, 60);
    }
    function streamXOR(key, nonce, src, dst, nonceInplaceCounterLength) {
      if (nonceInplaceCounterLength === void 0) {
        nonceInplaceCounterLength = 0;
      }
      if (key.length !== 32) {
        throw new Error("Salsa20: key size must be 32 bytes");
      }
      if (dst.length < src.length) {
        throw new Error("Salsa20: destination is shorter than source");
      }
      var nc;
      var counterStart;
      if (nonceInplaceCounterLength === 0) {
        if (nonce.length !== 8) {
          throw new Error("Salsa20 nonce must be 8 bytes");
        }
        nc = new Uint8Array(16);
        nc.set(nonce);
        counterStart = nonce.length;
      } else {
        if (nonce.length !== 16) {
          throw new Error("Salsa20 nonce with counter must be 16 bytes");
        }
        nc = nonce;
        counterStart = 16 - nonceInplaceCounterLength;
      }
      var block = new Uint8Array(64);
      for (var i = 0; i < src.length; i += 64) {
        core(block, nc, key);
        for (var j = i; j < i + 64 && j < src.length; j++) {
          dst[j] = src[j] ^ block[j - i];
        }
        incrementCounter(nc, counterStart, nc.length - counterStart);
      }
      wipe_1.wipe(block);
      if (nonceInplaceCounterLength === 0) {
        wipe_1.wipe(nc);
      }
      return dst;
    }
    exports.streamXOR = streamXOR;
    function stream(key, nonce, dst, nonceInplaceCounterLength) {
      if (nonceInplaceCounterLength === void 0) {
        nonceInplaceCounterLength = 0;
      }
      wipe_1.wipe(dst);
      return streamXOR(key, nonce, dst, dst, nonceInplaceCounterLength);
    }
    exports.stream = stream;
    function incrementCounter(counter, pos, len) {
      var carry = 1;
      while (len--) {
        carry = carry + (counter[pos] & 255) | 0;
        counter[pos] = carry & 255;
        carry >>>= 8;
        pos++;
      }
      if (carry > 0) {
        throw new Error("Salsa20: counter overflow");
      }
    }
  }
});

// node_modules/@stablelib/xsalsa20/lib/xsalsa20.js
var require_xsalsa20 = __commonJS({
  "node_modules/@stablelib/xsalsa20/lib/xsalsa20.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var binary_1 = require_binary();
    var salsa20_1 = require_salsa20();
    var wipe_1 = require_wipe();
    function streamXOR(key, nonce, src, dst, nonceInplaceCounterLength) {
      if (nonceInplaceCounterLength === void 0) {
        nonceInplaceCounterLength = 0;
      }
      if (nonceInplaceCounterLength === 0) {
        if (nonce.length !== 24) {
          throw new Error("XSalsa20 nonce must be 24 bytes");
        }
      } else {
        if (nonce.length !== 32) {
          throw new Error("XSalsa20 nonce with counter must be 32 bytes");
        }
      }
      var subkey = hsalsa(key, nonce.subarray(0, 16), new Uint8Array(32));
      var result = salsa20_1.streamXOR(subkey, nonce.subarray(16), src, dst, nonceInplaceCounterLength);
      wipe_1.wipe(subkey);
      return result;
    }
    exports.streamXOR = streamXOR;
    function stream(key, nonce, dst, nonceInplaceCounterLength) {
      if (nonceInplaceCounterLength === void 0) {
        nonceInplaceCounterLength = 0;
      }
      wipe_1.wipe(dst);
      return streamXOR(key, nonce, dst, dst, nonceInplaceCounterLength);
    }
    exports.stream = stream;
    var ROUNDS = 20;
    function hsalsa(key, src, dst) {
      var x0 = 1634760805;
      var x1 = key[3] << 24 | key[2] << 16 | key[1] << 8 | key[0];
      var x2 = key[7] << 24 | key[6] << 16 | key[5] << 8 | key[4];
      var x3 = key[11] << 24 | key[10] << 16 | key[9] << 8 | key[8];
      var x4 = key[15] << 24 | key[14] << 16 | key[13] << 8 | key[12];
      var x5 = 857760878;
      var x6 = src[3] << 24 | src[2] << 16 | src[1] << 8 | src[0];
      var x7 = src[7] << 24 | src[6] << 16 | src[5] << 8 | src[4];
      var x8 = src[11] << 24 | src[10] << 16 | src[9] << 8 | src[8];
      var x9 = src[15] << 24 | src[14] << 16 | src[13] << 8 | src[12];
      var x10 = 2036477234;
      var x11 = key[19] << 24 | key[18] << 16 | key[17] << 8 | key[16];
      var x12 = key[23] << 24 | key[22] << 16 | key[21] << 8 | key[20];
      var x13 = key[27] << 24 | key[26] << 16 | key[25] << 8 | key[24];
      var x14 = key[31] << 24 | key[30] << 16 | key[29] << 8 | key[28];
      var x15 = 1797285236;
      var u;
      for (var i = 0; i < ROUNDS; i += 2) {
        u = x0 + x12 | 0;
        x4 ^= u << 7 | u >>> 32 - 7;
        u = x4 + x0 | 0;
        x8 ^= u << 9 | u >>> 32 - 9;
        u = x8 + x4 | 0;
        x12 ^= u << 13 | u >>> 32 - 13;
        u = x12 + x8 | 0;
        x0 ^= u << 18 | u >>> 32 - 18;
        u = x5 + x1 | 0;
        x9 ^= u << 7 | u >>> 32 - 7;
        u = x9 + x5 | 0;
        x13 ^= u << 9 | u >>> 32 - 9;
        u = x13 + x9 | 0;
        x1 ^= u << 13 | u >>> 32 - 13;
        u = x1 + x13 | 0;
        x5 ^= u << 18 | u >>> 32 - 18;
        u = x10 + x6 | 0;
        x14 ^= u << 7 | u >>> 32 - 7;
        u = x14 + x10 | 0;
        x2 ^= u << 9 | u >>> 32 - 9;
        u = x2 + x14 | 0;
        x6 ^= u << 13 | u >>> 32 - 13;
        u = x6 + x2 | 0;
        x10 ^= u << 18 | u >>> 32 - 18;
        u = x15 + x11 | 0;
        x3 ^= u << 7 | u >>> 32 - 7;
        u = x3 + x15 | 0;
        x7 ^= u << 9 | u >>> 32 - 9;
        u = x7 + x3 | 0;
        x11 ^= u << 13 | u >>> 32 - 13;
        u = x11 + x7 | 0;
        x15 ^= u << 18 | u >>> 32 - 18;
        u = x0 + x3 | 0;
        x1 ^= u << 7 | u >>> 32 - 7;
        u = x1 + x0 | 0;
        x2 ^= u << 9 | u >>> 32 - 9;
        u = x2 + x1 | 0;
        x3 ^= u << 13 | u >>> 32 - 13;
        u = x3 + x2 | 0;
        x0 ^= u << 18 | u >>> 32 - 18;
        u = x5 + x4 | 0;
        x6 ^= u << 7 | u >>> 32 - 7;
        u = x6 + x5 | 0;
        x7 ^= u << 9 | u >>> 32 - 9;
        u = x7 + x6 | 0;
        x4 ^= u << 13 | u >>> 32 - 13;
        u = x4 + x7 | 0;
        x5 ^= u << 18 | u >>> 32 - 18;
        u = x10 + x9 | 0;
        x11 ^= u << 7 | u >>> 32 - 7;
        u = x11 + x10 | 0;
        x8 ^= u << 9 | u >>> 32 - 9;
        u = x8 + x11 | 0;
        x9 ^= u << 13 | u >>> 32 - 13;
        u = x9 + x8 | 0;
        x10 ^= u << 18 | u >>> 32 - 18;
        u = x15 + x14 | 0;
        x12 ^= u << 7 | u >>> 32 - 7;
        u = x12 + x15 | 0;
        x13 ^= u << 9 | u >>> 32 - 9;
        u = x13 + x12 | 0;
        x14 ^= u << 13 | u >>> 32 - 13;
        u = x14 + x13 | 0;
        x15 ^= u << 18 | u >>> 32 - 18;
      }
      binary_1.writeUint32LE(x0, dst, 0);
      binary_1.writeUint32LE(x5, dst, 4);
      binary_1.writeUint32LE(x10, dst, 8);
      binary_1.writeUint32LE(x15, dst, 12);
      binary_1.writeUint32LE(x6, dst, 16);
      binary_1.writeUint32LE(x7, dst, 20);
      binary_1.writeUint32LE(x8, dst, 24);
      binary_1.writeUint32LE(x9, dst, 28);
      return dst;
    }
    exports.hsalsa = hsalsa;
  }
});

// node_modules/@stablelib/constant-time/lib/constant-time.js
var require_constant_time = __commonJS({
  "node_modules/@stablelib/constant-time/lib/constant-time.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function select(subject, resultIfOne, resultIfZero) {
      return ~(subject - 1) & resultIfOne | subject - 1 & resultIfZero;
    }
    exports.select = select;
    function lessOrEqual(a, b) {
      return (a | 0) - (b | 0) - 1 >>> 31 & 1;
    }
    exports.lessOrEqual = lessOrEqual;
    function compare(a, b) {
      if (a.length !== b.length) {
        return 0;
      }
      var result = 0;
      for (var i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
      }
      return 1 & result - 1 >>> 8;
    }
    exports.compare = compare;
    function equal(a, b) {
      if (a.length === 0 || b.length === 0) {
        return false;
      }
      return compare(a, b) !== 0;
    }
    exports.equal = equal;
  }
});

// node_modules/@stablelib/poly1305/lib/poly1305.js
var require_poly1305 = __commonJS({
  "node_modules/@stablelib/poly1305/lib/poly1305.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var constant_time_1 = require_constant_time();
    var wipe_1 = require_wipe();
    exports.DIGEST_LENGTH = 16;
    var Poly1305 = (
      /** @class */
      function() {
        function Poly13052(key) {
          this.digestLength = exports.DIGEST_LENGTH;
          this._buffer = new Uint8Array(16);
          this._r = new Uint16Array(10);
          this._h = new Uint16Array(10);
          this._pad = new Uint16Array(8);
          this._leftover = 0;
          this._fin = 0;
          this._finished = false;
          var t0 = key[0] | key[1] << 8;
          this._r[0] = t0 & 8191;
          var t1 = key[2] | key[3] << 8;
          this._r[1] = (t0 >>> 13 | t1 << 3) & 8191;
          var t2 = key[4] | key[5] << 8;
          this._r[2] = (t1 >>> 10 | t2 << 6) & 7939;
          var t3 = key[6] | key[7] << 8;
          this._r[3] = (t2 >>> 7 | t3 << 9) & 8191;
          var t4 = key[8] | key[9] << 8;
          this._r[4] = (t3 >>> 4 | t4 << 12) & 255;
          this._r[5] = t4 >>> 1 & 8190;
          var t5 = key[10] | key[11] << 8;
          this._r[6] = (t4 >>> 14 | t5 << 2) & 8191;
          var t6 = key[12] | key[13] << 8;
          this._r[7] = (t5 >>> 11 | t6 << 5) & 8065;
          var t7 = key[14] | key[15] << 8;
          this._r[8] = (t6 >>> 8 | t7 << 8) & 8191;
          this._r[9] = t7 >>> 5 & 127;
          this._pad[0] = key[16] | key[17] << 8;
          this._pad[1] = key[18] | key[19] << 8;
          this._pad[2] = key[20] | key[21] << 8;
          this._pad[3] = key[22] | key[23] << 8;
          this._pad[4] = key[24] | key[25] << 8;
          this._pad[5] = key[26] | key[27] << 8;
          this._pad[6] = key[28] | key[29] << 8;
          this._pad[7] = key[30] | key[31] << 8;
        }
        Poly13052.prototype._blocks = function(m, mpos, bytes) {
          var hibit = this._fin ? 0 : 1 << 11;
          var h0 = this._h[0], h1 = this._h[1], h2 = this._h[2], h3 = this._h[3], h4 = this._h[4], h5 = this._h[5], h6 = this._h[6], h7 = this._h[7], h8 = this._h[8], h9 = this._h[9];
          var r0 = this._r[0], r1 = this._r[1], r2 = this._r[2], r3 = this._r[3], r4 = this._r[4], r5 = this._r[5], r6 = this._r[6], r7 = this._r[7], r8 = this._r[8], r9 = this._r[9];
          while (bytes >= 16) {
            var t0 = m[mpos + 0] | m[mpos + 1] << 8;
            h0 += t0 & 8191;
            var t1 = m[mpos + 2] | m[mpos + 3] << 8;
            h1 += (t0 >>> 13 | t1 << 3) & 8191;
            var t2 = m[mpos + 4] | m[mpos + 5] << 8;
            h2 += (t1 >>> 10 | t2 << 6) & 8191;
            var t3 = m[mpos + 6] | m[mpos + 7] << 8;
            h3 += (t2 >>> 7 | t3 << 9) & 8191;
            var t4 = m[mpos + 8] | m[mpos + 9] << 8;
            h4 += (t3 >>> 4 | t4 << 12) & 8191;
            h5 += t4 >>> 1 & 8191;
            var t5 = m[mpos + 10] | m[mpos + 11] << 8;
            h6 += (t4 >>> 14 | t5 << 2) & 8191;
            var t6 = m[mpos + 12] | m[mpos + 13] << 8;
            h7 += (t5 >>> 11 | t6 << 5) & 8191;
            var t7 = m[mpos + 14] | m[mpos + 15] << 8;
            h8 += (t6 >>> 8 | t7 << 8) & 8191;
            h9 += t7 >>> 5 | hibit;
            var c = 0;
            var d0 = c;
            d0 += h0 * r0;
            d0 += h1 * (5 * r9);
            d0 += h2 * (5 * r8);
            d0 += h3 * (5 * r7);
            d0 += h4 * (5 * r6);
            c = d0 >>> 13;
            d0 &= 8191;
            d0 += h5 * (5 * r5);
            d0 += h6 * (5 * r4);
            d0 += h7 * (5 * r3);
            d0 += h8 * (5 * r2);
            d0 += h9 * (5 * r1);
            c += d0 >>> 13;
            d0 &= 8191;
            var d1 = c;
            d1 += h0 * r1;
            d1 += h1 * r0;
            d1 += h2 * (5 * r9);
            d1 += h3 * (5 * r8);
            d1 += h4 * (5 * r7);
            c = d1 >>> 13;
            d1 &= 8191;
            d1 += h5 * (5 * r6);
            d1 += h6 * (5 * r5);
            d1 += h7 * (5 * r4);
            d1 += h8 * (5 * r3);
            d1 += h9 * (5 * r2);
            c += d1 >>> 13;
            d1 &= 8191;
            var d2 = c;
            d2 += h0 * r2;
            d2 += h1 * r1;
            d2 += h2 * r0;
            d2 += h3 * (5 * r9);
            d2 += h4 * (5 * r8);
            c = d2 >>> 13;
            d2 &= 8191;
            d2 += h5 * (5 * r7);
            d2 += h6 * (5 * r6);
            d2 += h7 * (5 * r5);
            d2 += h8 * (5 * r4);
            d2 += h9 * (5 * r3);
            c += d2 >>> 13;
            d2 &= 8191;
            var d3 = c;
            d3 += h0 * r3;
            d3 += h1 * r2;
            d3 += h2 * r1;
            d3 += h3 * r0;
            d3 += h4 * (5 * r9);
            c = d3 >>> 13;
            d3 &= 8191;
            d3 += h5 * (5 * r8);
            d3 += h6 * (5 * r7);
            d3 += h7 * (5 * r6);
            d3 += h8 * (5 * r5);
            d3 += h9 * (5 * r4);
            c += d3 >>> 13;
            d3 &= 8191;
            var d4 = c;
            d4 += h0 * r4;
            d4 += h1 * r3;
            d4 += h2 * r2;
            d4 += h3 * r1;
            d4 += h4 * r0;
            c = d4 >>> 13;
            d4 &= 8191;
            d4 += h5 * (5 * r9);
            d4 += h6 * (5 * r8);
            d4 += h7 * (5 * r7);
            d4 += h8 * (5 * r6);
            d4 += h9 * (5 * r5);
            c += d4 >>> 13;
            d4 &= 8191;
            var d5 = c;
            d5 += h0 * r5;
            d5 += h1 * r4;
            d5 += h2 * r3;
            d5 += h3 * r2;
            d5 += h4 * r1;
            c = d5 >>> 13;
            d5 &= 8191;
            d5 += h5 * r0;
            d5 += h6 * (5 * r9);
            d5 += h7 * (5 * r8);
            d5 += h8 * (5 * r7);
            d5 += h9 * (5 * r6);
            c += d5 >>> 13;
            d5 &= 8191;
            var d6 = c;
            d6 += h0 * r6;
            d6 += h1 * r5;
            d6 += h2 * r4;
            d6 += h3 * r3;
            d6 += h4 * r2;
            c = d6 >>> 13;
            d6 &= 8191;
            d6 += h5 * r1;
            d6 += h6 * r0;
            d6 += h7 * (5 * r9);
            d6 += h8 * (5 * r8);
            d6 += h9 * (5 * r7);
            c += d6 >>> 13;
            d6 &= 8191;
            var d7 = c;
            d7 += h0 * r7;
            d7 += h1 * r6;
            d7 += h2 * r5;
            d7 += h3 * r4;
            d7 += h4 * r3;
            c = d7 >>> 13;
            d7 &= 8191;
            d7 += h5 * r2;
            d7 += h6 * r1;
            d7 += h7 * r0;
            d7 += h8 * (5 * r9);
            d7 += h9 * (5 * r8);
            c += d7 >>> 13;
            d7 &= 8191;
            var d8 = c;
            d8 += h0 * r8;
            d8 += h1 * r7;
            d8 += h2 * r6;
            d8 += h3 * r5;
            d8 += h4 * r4;
            c = d8 >>> 13;
            d8 &= 8191;
            d8 += h5 * r3;
            d8 += h6 * r2;
            d8 += h7 * r1;
            d8 += h8 * r0;
            d8 += h9 * (5 * r9);
            c += d8 >>> 13;
            d8 &= 8191;
            var d9 = c;
            d9 += h0 * r9;
            d9 += h1 * r8;
            d9 += h2 * r7;
            d9 += h3 * r6;
            d9 += h4 * r5;
            c = d9 >>> 13;
            d9 &= 8191;
            d9 += h5 * r4;
            d9 += h6 * r3;
            d9 += h7 * r2;
            d9 += h8 * r1;
            d9 += h9 * r0;
            c += d9 >>> 13;
            d9 &= 8191;
            c = (c << 2) + c | 0;
            c = c + d0 | 0;
            d0 = c & 8191;
            c = c >>> 13;
            d1 += c;
            h0 = d0;
            h1 = d1;
            h2 = d2;
            h3 = d3;
            h4 = d4;
            h5 = d5;
            h6 = d6;
            h7 = d7;
            h8 = d8;
            h9 = d9;
            mpos += 16;
            bytes -= 16;
          }
          this._h[0] = h0;
          this._h[1] = h1;
          this._h[2] = h2;
          this._h[3] = h3;
          this._h[4] = h4;
          this._h[5] = h5;
          this._h[6] = h6;
          this._h[7] = h7;
          this._h[8] = h8;
          this._h[9] = h9;
        };
        Poly13052.prototype.finish = function(mac, macpos) {
          if (macpos === void 0) {
            macpos = 0;
          }
          var g = new Uint16Array(10);
          var c;
          var mask;
          var f;
          var i;
          if (this._leftover) {
            i = this._leftover;
            this._buffer[i++] = 1;
            for (; i < 16; i++) {
              this._buffer[i] = 0;
            }
            this._fin = 1;
            this._blocks(this._buffer, 0, 16);
          }
          c = this._h[1] >>> 13;
          this._h[1] &= 8191;
          for (i = 2; i < 10; i++) {
            this._h[i] += c;
            c = this._h[i] >>> 13;
            this._h[i] &= 8191;
          }
          this._h[0] += c * 5;
          c = this._h[0] >>> 13;
          this._h[0] &= 8191;
          this._h[1] += c;
          c = this._h[1] >>> 13;
          this._h[1] &= 8191;
          this._h[2] += c;
          g[0] = this._h[0] + 5;
          c = g[0] >>> 13;
          g[0] &= 8191;
          for (i = 1; i < 10; i++) {
            g[i] = this._h[i] + c;
            c = g[i] >>> 13;
            g[i] &= 8191;
          }
          g[9] -= 1 << 13;
          mask = (c ^ 1) - 1;
          for (i = 0; i < 10; i++) {
            g[i] &= mask;
          }
          mask = ~mask;
          for (i = 0; i < 10; i++) {
            this._h[i] = this._h[i] & mask | g[i];
          }
          this._h[0] = (this._h[0] | this._h[1] << 13) & 65535;
          this._h[1] = (this._h[1] >>> 3 | this._h[2] << 10) & 65535;
          this._h[2] = (this._h[2] >>> 6 | this._h[3] << 7) & 65535;
          this._h[3] = (this._h[3] >>> 9 | this._h[4] << 4) & 65535;
          this._h[4] = (this._h[4] >>> 12 | this._h[5] << 1 | this._h[6] << 14) & 65535;
          this._h[5] = (this._h[6] >>> 2 | this._h[7] << 11) & 65535;
          this._h[6] = (this._h[7] >>> 5 | this._h[8] << 8) & 65535;
          this._h[7] = (this._h[8] >>> 8 | this._h[9] << 5) & 65535;
          f = this._h[0] + this._pad[0];
          this._h[0] = f & 65535;
          for (i = 1; i < 8; i++) {
            f = (this._h[i] + this._pad[i] | 0) + (f >>> 16) | 0;
            this._h[i] = f & 65535;
          }
          mac[macpos + 0] = this._h[0] >>> 0;
          mac[macpos + 1] = this._h[0] >>> 8;
          mac[macpos + 2] = this._h[1] >>> 0;
          mac[macpos + 3] = this._h[1] >>> 8;
          mac[macpos + 4] = this._h[2] >>> 0;
          mac[macpos + 5] = this._h[2] >>> 8;
          mac[macpos + 6] = this._h[3] >>> 0;
          mac[macpos + 7] = this._h[3] >>> 8;
          mac[macpos + 8] = this._h[4] >>> 0;
          mac[macpos + 9] = this._h[4] >>> 8;
          mac[macpos + 10] = this._h[5] >>> 0;
          mac[macpos + 11] = this._h[5] >>> 8;
          mac[macpos + 12] = this._h[6] >>> 0;
          mac[macpos + 13] = this._h[6] >>> 8;
          mac[macpos + 14] = this._h[7] >>> 0;
          mac[macpos + 15] = this._h[7] >>> 8;
          this._finished = true;
          return this;
        };
        Poly13052.prototype.update = function(m) {
          var mpos = 0;
          var bytes = m.length;
          var want;
          if (this._leftover) {
            want = 16 - this._leftover;
            if (want > bytes) {
              want = bytes;
            }
            for (var i = 0; i < want; i++) {
              this._buffer[this._leftover + i] = m[mpos + i];
            }
            bytes -= want;
            mpos += want;
            this._leftover += want;
            if (this._leftover < 16) {
              return this;
            }
            this._blocks(this._buffer, 0, 16);
            this._leftover = 0;
          }
          if (bytes >= 16) {
            want = bytes - bytes % 16;
            this._blocks(m, mpos, want);
            mpos += want;
            bytes -= want;
          }
          if (bytes) {
            for (var i = 0; i < bytes; i++) {
              this._buffer[this._leftover + i] = m[mpos + i];
            }
            this._leftover += bytes;
          }
          return this;
        };
        Poly13052.prototype.digest = function() {
          if (this._finished) {
            throw new Error("Poly1305 was finished");
          }
          var mac = new Uint8Array(16);
          this.finish(mac);
          return mac;
        };
        Poly13052.prototype.clean = function() {
          wipe_1.wipe(this._buffer);
          wipe_1.wipe(this._r);
          wipe_1.wipe(this._h);
          wipe_1.wipe(this._pad);
          this._leftover = 0;
          this._fin = 0;
          this._finished = true;
          return this;
        };
        return Poly13052;
      }()
    );
    exports.Poly1305 = Poly1305;
    function oneTimeAuth(key, data) {
      var h = new Poly1305(key);
      h.update(data);
      var digest = h.digest();
      h.clean();
      return digest;
    }
    exports.oneTimeAuth = oneTimeAuth;
    function equal(a, b) {
      if (a.length !== exports.DIGEST_LENGTH || b.length !== exports.DIGEST_LENGTH) {
        return false;
      }
      return constant_time_1.equal(a, b);
    }
    exports.equal = equal;
  }
});

// node_modules/@stablelib/nacl/lib/secretbox.js
var require_secretbox = __commonJS({
  "node_modules/@stablelib/nacl/lib/secretbox.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.generateKey = exports.openSecretBox = exports.secretBox = void 0;
    var xsalsa20_1 = require_xsalsa20();
    var poly1305_1 = require_poly1305();
    var wipe_1 = require_wipe();
    var random_1 = require_random();
    function secretBox(key, nonce, data) {
      if (nonce.length !== 24) {
        throw new Error("secretBox nonce must be 24 bytes");
      }
      const firstBlock = new Uint8Array(64);
      const nonceCounter = new Uint8Array(24 + 8);
      nonceCounter.set(nonce);
      (0, xsalsa20_1.stream)(key, nonceCounter, firstBlock, 8);
      const result = new Uint8Array(16 + data.length);
      for (let i = 0; i < 32 && i < data.length; i++) {
        result[16 + i] = data[i] ^ firstBlock[32 + i];
      }
      if (data.length > 32) {
        (0, xsalsa20_1.streamXOR)(key, nonceCounter, data.subarray(32), result.subarray(16 + 32), 8);
      }
      const auth = (0, poly1305_1.oneTimeAuth)(firstBlock.subarray(0, 32), result.subarray(16));
      for (let i = 0; i < auth.length; i++) {
        result[i] = auth[i];
      }
      (0, wipe_1.wipe)(auth);
      (0, wipe_1.wipe)(firstBlock);
      (0, wipe_1.wipe)(nonceCounter);
      return result;
    }
    exports.secretBox = secretBox;
    function openSecretBox(key, nonce, box2) {
      if (nonce.length !== 24) {
        throw new Error("secretBox nonce must be 24 bytes");
      }
      if (box2.length < 16) {
        throw new Error("secretBox data must be at least 16 bytes");
      }
      const firstBlock = new Uint8Array(64);
      const nonceCounter = new Uint8Array(24 + 8);
      nonceCounter.set(nonce);
      (0, xsalsa20_1.stream)(key, nonceCounter, firstBlock, 8);
      const auth = (0, poly1305_1.oneTimeAuth)(firstBlock.subarray(0, 32), box2.subarray(16));
      if (!(0, poly1305_1.equal)(auth, box2.subarray(0, 16))) {
        return null;
      }
      const ciphertext = box2.subarray(16);
      const result = new Uint8Array(ciphertext.length);
      for (let i = 0; i < 32 && i < ciphertext.length; i++) {
        result[i] = ciphertext[i] ^ firstBlock[32 + i];
      }
      if (ciphertext.length > 32) {
        (0, xsalsa20_1.streamXOR)(key, nonceCounter, ciphertext.subarray(32), result.subarray(32), 8);
      }
      (0, wipe_1.wipe)(auth);
      (0, wipe_1.wipe)(firstBlock);
      (0, wipe_1.wipe)(nonceCounter);
      return result;
    }
    exports.openSecretBox = openSecretBox;
    function generateKey(prng) {
      return (0, random_1.randomBytes)(32, prng);
    }
    exports.generateKey = generateKey;
  }
});

// node_modules/@stablelib/nacl/lib/box.js
var require_box = __commonJS({
  "node_modules/@stablelib/nacl/lib/box.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.openBox = exports.box = exports.precomputeSharedKey = exports.generateKeyPair = void 0;
    var x25519_1 = require_x25519();
    var xsalsa20_1 = require_xsalsa20();
    var secretbox_1 = require_secretbox();
    var wipe_1 = require_wipe();
    var x25519_2 = require_x25519();
    Object.defineProperty(exports, "generateKeyPair", { enumerable: true, get: function() {
      return x25519_2.generateKeyPair;
    } });
    var zeros16 = new Uint8Array(16);
    function precomputeSharedKey(theirPublicKey, mySecretKey) {
      const key = (0, x25519_1.scalarMult)(mySecretKey, theirPublicKey);
      (0, xsalsa20_1.hsalsa)(key, zeros16, key);
      return key;
    }
    exports.precomputeSharedKey = precomputeSharedKey;
    function box2(theirPublicKey, mySecretKey, nonce, data) {
      const sharedKey = precomputeSharedKey(theirPublicKey, mySecretKey);
      const result = (0, secretbox_1.secretBox)(sharedKey, nonce, data);
      (0, wipe_1.wipe)(sharedKey);
      return result;
    }
    exports.box = box2;
    function openBox2(theirPublicKey, mySecretKey, nonce, data) {
      const sharedKey = precomputeSharedKey(theirPublicKey, mySecretKey);
      const result = (0, secretbox_1.openSecretBox)(sharedKey, nonce, data);
      (0, wipe_1.wipe)(sharedKey);
      return result;
    }
    exports.openBox = openBox2;
  }
});

// node_modules/@stablelib/nacl/lib/nacl.js
var require_nacl = __commonJS({
  "node_modules/@stablelib/nacl/lib/nacl.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    } : function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    });
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_box(), exports);
    __exportStar(require_secretbox(), exports);
  }
});

// node_modules/@stablelib/base64/lib/base64.js
var require_base64 = __commonJS({
  "node_modules/@stablelib/base64/lib/base64.js"(exports) {
    "use strict";
    var __extends = exports && exports.__extends || /* @__PURE__ */ function() {
      var extendStatics = function(d, b) {
        extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
          d2.__proto__ = b2;
        } || function(d2, b2) {
          for (var p in b2) if (b2.hasOwnProperty(p)) d2[p] = b2[p];
        };
        return extendStatics(d, b);
      };
      return function(d, b) {
        extendStatics(d, b);
        function __() {
          this.constructor = d;
        }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
      };
    }();
    Object.defineProperty(exports, "__esModule", { value: true });
    var INVALID_BYTE = 256;
    var Coder = (
      /** @class */
      function() {
        function Coder2(_paddingCharacter) {
          if (_paddingCharacter === void 0) {
            _paddingCharacter = "=";
          }
          this._paddingCharacter = _paddingCharacter;
        }
        Coder2.prototype.encodedLength = function(length) {
          if (!this._paddingCharacter) {
            return (length * 8 + 5) / 6 | 0;
          }
          return (length + 2) / 3 * 4 | 0;
        };
        Coder2.prototype.encode = function(data) {
          var out = "";
          var i = 0;
          for (; i < data.length - 2; i += 3) {
            var c = data[i] << 16 | data[i + 1] << 8 | data[i + 2];
            out += this._encodeByte(c >>> 3 * 6 & 63);
            out += this._encodeByte(c >>> 2 * 6 & 63);
            out += this._encodeByte(c >>> 1 * 6 & 63);
            out += this._encodeByte(c >>> 0 * 6 & 63);
          }
          var left = data.length - i;
          if (left > 0) {
            var c = data[i] << 16 | (left === 2 ? data[i + 1] << 8 : 0);
            out += this._encodeByte(c >>> 3 * 6 & 63);
            out += this._encodeByte(c >>> 2 * 6 & 63);
            if (left === 2) {
              out += this._encodeByte(c >>> 1 * 6 & 63);
            } else {
              out += this._paddingCharacter || "";
            }
            out += this._paddingCharacter || "";
          }
          return out;
        };
        Coder2.prototype.maxDecodedLength = function(length) {
          if (!this._paddingCharacter) {
            return (length * 6 + 7) / 8 | 0;
          }
          return length / 4 * 3 | 0;
        };
        Coder2.prototype.decodedLength = function(s) {
          return this.maxDecodedLength(s.length - this._getPaddingLength(s));
        };
        Coder2.prototype.decode = function(s) {
          if (s.length === 0) {
            return new Uint8Array(0);
          }
          var paddingLength = this._getPaddingLength(s);
          var length = s.length - paddingLength;
          var out = new Uint8Array(this.maxDecodedLength(length));
          var op = 0;
          var i = 0;
          var haveBad = 0;
          var v0 = 0, v1 = 0, v2 = 0, v3 = 0;
          for (; i < length - 4; i += 4) {
            v0 = this._decodeChar(s.charCodeAt(i + 0));
            v1 = this._decodeChar(s.charCodeAt(i + 1));
            v2 = this._decodeChar(s.charCodeAt(i + 2));
            v3 = this._decodeChar(s.charCodeAt(i + 3));
            out[op++] = v0 << 2 | v1 >>> 4;
            out[op++] = v1 << 4 | v2 >>> 2;
            out[op++] = v2 << 6 | v3;
            haveBad |= v0 & INVALID_BYTE;
            haveBad |= v1 & INVALID_BYTE;
            haveBad |= v2 & INVALID_BYTE;
            haveBad |= v3 & INVALID_BYTE;
          }
          if (i < length - 1) {
            v0 = this._decodeChar(s.charCodeAt(i));
            v1 = this._decodeChar(s.charCodeAt(i + 1));
            out[op++] = v0 << 2 | v1 >>> 4;
            haveBad |= v0 & INVALID_BYTE;
            haveBad |= v1 & INVALID_BYTE;
          }
          if (i < length - 2) {
            v2 = this._decodeChar(s.charCodeAt(i + 2));
            out[op++] = v1 << 4 | v2 >>> 2;
            haveBad |= v2 & INVALID_BYTE;
          }
          if (i < length - 3) {
            v3 = this._decodeChar(s.charCodeAt(i + 3));
            out[op++] = v2 << 6 | v3;
            haveBad |= v3 & INVALID_BYTE;
          }
          if (haveBad !== 0) {
            throw new Error("Base64Coder: incorrect characters for decoding");
          }
          return out;
        };
        Coder2.prototype._encodeByte = function(b) {
          var result = b;
          result += 65;
          result += 25 - b >>> 8 & 0 - 65 - 26 + 97;
          result += 51 - b >>> 8 & 26 - 97 - 52 + 48;
          result += 61 - b >>> 8 & 52 - 48 - 62 + 43;
          result += 62 - b >>> 8 & 62 - 43 - 63 + 47;
          return String.fromCharCode(result);
        };
        Coder2.prototype._decodeChar = function(c) {
          var result = INVALID_BYTE;
          result += (42 - c & c - 44) >>> 8 & -INVALID_BYTE + c - 43 + 62;
          result += (46 - c & c - 48) >>> 8 & -INVALID_BYTE + c - 47 + 63;
          result += (47 - c & c - 58) >>> 8 & -INVALID_BYTE + c - 48 + 52;
          result += (64 - c & c - 91) >>> 8 & -INVALID_BYTE + c - 65 + 0;
          result += (96 - c & c - 123) >>> 8 & -INVALID_BYTE + c - 97 + 26;
          return result;
        };
        Coder2.prototype._getPaddingLength = function(s) {
          var paddingLength = 0;
          if (this._paddingCharacter) {
            for (var i = s.length - 1; i >= 0; i--) {
              if (s[i] !== this._paddingCharacter) {
                break;
              }
              paddingLength++;
            }
            if (s.length < 4 || paddingLength > 2) {
              throw new Error("Base64Coder: incorrect padding");
            }
          }
          return paddingLength;
        };
        return Coder2;
      }()
    );
    exports.Coder = Coder;
    var stdCoder = new Coder();
    function encode(data) {
      return stdCoder.encode(data);
    }
    exports.encode = encode;
    function decode(s) {
      return stdCoder.decode(s);
    }
    exports.decode = decode;
    var URLSafeCoder = (
      /** @class */
      function(_super) {
        __extends(URLSafeCoder2, _super);
        function URLSafeCoder2() {
          return _super !== null && _super.apply(this, arguments) || this;
        }
        URLSafeCoder2.prototype._encodeByte = function(b) {
          var result = b;
          result += 65;
          result += 25 - b >>> 8 & 0 - 65 - 26 + 97;
          result += 51 - b >>> 8 & 26 - 97 - 52 + 48;
          result += 61 - b >>> 8 & 52 - 48 - 62 + 45;
          result += 62 - b >>> 8 & 62 - 45 - 63 + 95;
          return String.fromCharCode(result);
        };
        URLSafeCoder2.prototype._decodeChar = function(c) {
          var result = INVALID_BYTE;
          result += (44 - c & c - 46) >>> 8 & -INVALID_BYTE + c - 45 + 62;
          result += (94 - c & c - 96) >>> 8 & -INVALID_BYTE + c - 95 + 63;
          result += (47 - c & c - 58) >>> 8 & -INVALID_BYTE + c - 48 + 52;
          result += (64 - c & c - 91) >>> 8 & -INVALID_BYTE + c - 65 + 0;
          result += (96 - c & c - 123) >>> 8 & -INVALID_BYTE + c - 97 + 26;
          return result;
        };
        return URLSafeCoder2;
      }(Coder)
    );
    exports.URLSafeCoder = URLSafeCoder;
    var urlSafeCoder = new URLSafeCoder();
    function encodeURLSafe(data) {
      return urlSafeCoder.encode(data);
    }
    exports.encodeURLSafe = encodeURLSafe;
    function decodeURLSafe(s) {
      return urlSafeCoder.decode(s);
    }
    exports.decodeURLSafe = decodeURLSafe;
    exports.encodedLength = function(length) {
      return stdCoder.encodedLength(length);
    };
    exports.maxDecodedLength = function(length) {
      return stdCoder.maxDecodedLength(length);
    };
    exports.decodedLength = function(s) {
      return stdCoder.decodedLength(s);
    };
  }
});

// src/crypto.ts
var import_nacl = __toESM(require_nacl(), 1);
var import_x25519 = __toESM(require_x25519(), 1);
var import_random = __toESM(require_random(), 1);
var import_base64 = __toESM(require_base64(), 1);
async function generateEphemeralKeypair() {
  void (0, import_random.randomBytes)(1);
  const kp = (0, import_x25519.generateKeyPair)();
  return {
    secretKey: kp.secretKey,
    publicKey: kp.publicKey,
    publicKeyB64u: stripPad((0, import_base64.encodeURLSafe)(kp.publicKey))
  };
}
async function decryptEnvelope(raw, keys) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("decryptEnvelope: not a JSON envelope");
  }
  if (typeof parsed.ephPk !== "string" || typeof parsed.nonce24 !== "string" || typeof parsed.ct !== "string") {
    throw new Error("decryptEnvelope: missing required fields {ephPk, nonce24, ct}");
  }
  const ephPk = (0, import_base64.decodeURLSafe)(addPad(parsed.ephPk));
  const nonce = (0, import_base64.decodeURLSafe)(addPad(parsed.nonce24));
  const ct = (0, import_base64.decodeURLSafe)(addPad(parsed.ct));
  if (ephPk.length !== 32) throw new Error("decryptEnvelope: bad ephPk length");
  if (nonce.length !== 24) throw new Error("decryptEnvelope: bad nonce length");
  const pt = (0, import_nacl.openBox)(ephPk, keys.secretKey, nonce, ct);
  if (!pt) throw new Error("decryptEnvelope: authentication failed (wrong key or tampered ciphertext)");
  try {
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new Error("decryptEnvelope: decrypted but not JSON");
  }
}
function stripPad(s) {
  return s.replace(/=+$/, "");
}
function addPad(s) {
  const mod = s.length % 4;
  return mod === 0 ? s : s + "=".repeat(4 - mod);
}
function boxToWallet(walletSessionPkB64u, plaintext) {
  const recipientPk = (0, import_base64.decodeURLSafe)(addPad(walletSessionPkB64u));
  if (recipientPk.length !== 32) {
    throw new Error("boxToWallet: bad walletSessionPk length");
  }
  const ephemeral = (0, import_x25519.generateKeyPair)();
  const nonce = (0, import_random.randomBytes)(24);
  const pt = new TextEncoder().encode(plaintext);
  const ct = (0, import_nacl.box)(
    /* theirPublicKey */
    recipientPk,
    /* mySecretKey   */
    ephemeral.secretKey,
    nonce,
    pt
  );
  return JSON.stringify({
    ephPk: stripPad((0, import_base64.encodeURLSafe)(ephemeral.publicKey)),
    nonce24: stripPad((0, import_base64.encodeURLSafe)(nonce)),
    ct: stripPad((0, import_base64.encodeURLSafe)(ct))
  });
}

// src/verify.ts
var ANONYMOUS_WALLET_VCT = "https://app.prson.net/credentials/anonymous-wallet/v1";
async function verifyPresentation(sdJwt, opts) {
  if (!sdJwt.includes("~") && opts.acceptedVcts.includes(ANONYMOUS_WALLET_VCT)) {
    return verifyAnonymousWallet(sdJwt, opts);
  }
  const parts = sdJwt.split("~");
  if (parts.length < 2) return { ok: false, reason: "malformed" };
  const jws = parts[0];
  const tail = parts.slice(1);
  const last = tail[tail.length - 1];
  let kbJwt;
  let discTokens;
  if (last === "" || last === void 0) {
    discTokens = tail.slice(0, -1);
    return { ok: false, reason: "kb_missing" };
  } else if (last.includes(".")) {
    kbJwt = last;
    discTokens = tail.slice(0, -1);
  } else {
    return { ok: false, reason: "kb_missing" };
  }
  const [hB64, pB64, sigB64] = jws.split(".");
  if (!hB64 || !pB64 || !sigB64) return { ok: false, reason: "malformed" };
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64uBytes(hB64)));
    payload = JSON.parse(new TextDecoder().decode(b64uBytes(pB64)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.iss !== "string" || payload.iss !== opts.trustedIssuer) {
    return { ok: false, reason: "issuer_key_resolve_failed" };
  }
  if (typeof payload.vct !== "string" || !opts.acceptedVcts.includes(payload.vct)) {
    return { ok: false, reason: "vct_not_accepted" };
  }
  if (typeof payload.exp === "number" && payload.exp * 1e3 < Date.now()) {
    return { ok: false, reason: "vc_expired" };
  }
  const issuerJwk = await resolveIssuerJwk(header.kid ?? "", opts);
  if (!issuerJwk) return { ok: false, reason: "issuer_key_resolve_failed" };
  const issuerKey = await crypto.subtle.importKey(
    "jwk",
    issuerJwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const issuerOk = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    issuerKey,
    b64uBytes(sigB64),
    new TextEncoder().encode(`${hB64}.${pB64}`)
  );
  if (!issuerOk) return { ok: false, reason: "issuer_sig_invalid" };
  const sdSet = collectSdDigests(payload);
  const disclosed = [];
  for (const t of discTokens) {
    if (!t) continue;
    const arr = JSON.parse(new TextDecoder().decode(b64uBytes(t)));
    if (!Array.isArray(arr) || arr.length < 2) {
      return { ok: false, reason: "disclosure_unmatched" };
    }
    const digest = b64uEncode2(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))));
    if (!sdSet.has(digest)) return { ok: false, reason: "disclosure_unmatched" };
    if (arr.length === 3 && typeof arr[1] === "string") {
      disclosed.push({ name: arr[1], value: arr[2] });
    }
  }
  if (!kbJwt) return { ok: false, reason: "kb_missing" };
  const cnf = payload.cnf?.jwk;
  if (!cnf || cnf.kty !== "OKP" || cnf.crv !== "Ed25519") {
    return { ok: false, reason: "kb_missing" };
  }
  const [kbH, kbP, kbS] = kbJwt.split(".");
  if (!kbH || !kbP || !kbS) return { ok: false, reason: "kb_sig_invalid" };
  let kbHeader;
  let kbPayload;
  try {
    kbHeader = JSON.parse(new TextDecoder().decode(b64uBytes(kbH)));
    kbPayload = JSON.parse(new TextDecoder().decode(b64uBytes(kbP)));
  } catch {
    return { ok: false, reason: "kb_sig_invalid" };
  }
  if (kbHeader.alg !== "EdDSA" || kbHeader.typ !== "kb+jwt") {
    return { ok: false, reason: "kb_sig_invalid" };
  }
  if (kbPayload.aud !== opts.expectedAudience) return { ok: false, reason: "aud_mismatch" };
  if (kbPayload.nonce !== opts.expectedNonce) return { ok: false, reason: "nonce_mismatch" };
  if (typeof kbPayload.iat !== "number") return { ok: false, reason: "kb_iat_stale" };
  const maxAge = opts.maxKbAgeSeconds ?? 60;
  if (Math.abs(Date.now() / 1e3 - kbPayload.iat) > maxAge) {
    return { ok: false, reason: "kb_iat_stale" };
  }
  const prefixParts = discTokens.length === 0 ? [jws] : [jws, ...discTokens];
  const presentationPrefix = `${prefixParts.join("~")}~`;
  const sdHash = b64uEncode2(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(presentationPrefix))));
  if (kbPayload.sd_hash !== sdHash) return { ok: false, reason: "sd_hash_mismatch" };
  const holderKey = await crypto.subtle.importKey(
    "jwk",
    cnf,
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  const kbOk = await crypto.subtle.verify(
    "Ed25519",
    holderKey,
    b64uBytes(kbS),
    new TextEncoder().encode(`${kbH}.${kbP}`)
  );
  if (!kbOk) return { ok: false, reason: "kb_sig_invalid" };
  const claims = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === "_sd" || k === "_sd_alg" || k === "cnf") continue;
    if (["iss", "vct", "iat", "exp"].includes(k)) continue;
    claims[k] = v;
  }
  for (const d of disclosed) claims[d.name] = d.value;
  return {
    ok: true,
    claims,
    cnf: { jwk: cnf },
    credential: {
      vct: payload.vct,
      iss: payload.iss,
      kid: header.kid ?? "",
      expiresAt: typeof payload.exp === "number" ? payload.exp * 1e3 : 0
    }
  };
}
var jwksCache = /* @__PURE__ */ new Map();
async function resolveIssuerJwk(kid, opts) {
  if (!kid) return null;
  const host = opts.trustedIssuer.replace(/^did:web:/, "");
  const uri = opts.jwksUri ?? `https://${host}/.well-known/jwt-vc-issuer`;
  const cached = jwksCache.get(uri);
  if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1e3) {
    return cached.keys[kid] ?? null;
  }
  const res = await fetch(uri);
  if (!res.ok) return null;
  const body = await res.json();
  const keys = body.jwks?.keys ?? body.keys ?? [];
  const map = {};
  for (const k of keys) {
    const id = k.kid;
    if (id) map[id] = k;
  }
  jwksCache.set(uri, { fetchedAt: Date.now(), keys: map });
  return map[kid] ?? null;
}
function collectSdDigests(payload, out = /* @__PURE__ */ new Set()) {
  if (!payload || typeof payload !== "object") return out;
  if (Array.isArray(payload)) {
    for (const v of payload) collectSdDigests(v, out);
    return out;
  }
  const obj = payload;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "_sd" && Array.isArray(v)) {
      for (const digest of v) {
        if (typeof digest === "string") out.add(digest);
      }
    } else if (typeof v === "object") {
      collectSdDigests(v, out);
    }
  }
  return out;
}
function b64uBytes(s) {
  const pad = (4 - s.length % 4) % 4;
  const std = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64uEncode2(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function verifyAnonymousWallet(jws, opts) {
  const [hB64, pB64, sigB64] = jws.split(".");
  if (!hB64 || !pB64 || !sigB64) return { ok: false, reason: "malformed" };
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64uBytes(hB64)));
    payload = JSON.parse(new TextDecoder().decode(b64uBytes(pB64)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "EdDSA" || header.typ !== "anon-wallet+jwt") {
    return { ok: false, reason: "malformed" };
  }
  if (payload.vct !== ANONYMOUS_WALLET_VCT) {
    return { ok: false, reason: "vct_not_accepted" };
  }
  const cnf = payload.cnf?.jwk;
  if (!cnf || cnf.kty !== "OKP" || cnf.crv !== "Ed25519") {
    return { ok: false, reason: "kb_missing" };
  }
  if (payload.aud !== opts.expectedAudience) {
    return { ok: false, reason: "aud_mismatch" };
  }
  if (payload.nonce !== opts.expectedNonce) {
    return { ok: false, reason: "nonce_mismatch" };
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  if (typeof payload.exp !== "number" || payload.exp < nowSec) {
    return { ok: false, reason: "vc_expired" };
  }
  if (typeof payload.iat !== "number" || Math.abs(nowSec - payload.iat) > (opts.maxKbAgeSeconds ?? 60)) {
    return { ok: false, reason: "kb_iat_stale" };
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    cnf,
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    key,
    b64uBytes(sigB64),
    new TextEncoder().encode(`${hB64}.${pB64}`)
  );
  if (!ok) return { ok: false, reason: "issuer_sig_invalid" };
  return {
    ok: true,
    claims: {
      // Anonymous credentials carry no profile data — just the marker
      // that the user controls the signing key. The host site treats
      // cnf.jwk.x as the stable per-user id on this domain.
      anonymous: true
    },
    cnf: { jwk: cnf },
    credential: {
      vct: ANONYMOUS_WALLET_VCT,
      iss: typeof payload.iss === "string" ? payload.iss : opts.trustedIssuer,
      kid: "",
      expiresAt: payload.exp * 1e3
    }
  };
}

// src/requests.ts
var RequestController = class {
  constructor() {
    this._pending = /* @__PURE__ */ new Map();
    this._closed = false;
  }
  /**
   * Wire up a new outbound request. Returns the requestId to put in
   * the envelope + a `promise` that resolves when the wallet replies
   * (or times out / the session closes).
   */
  enqueue(timeoutMs) {
    const requestId = newUuid();
    const MAX_SAFE_TIMEOUT = 2147483e3;
    const safeTimeoutMs = Math.min(
      Math.max(0, timeoutMs),
      MAX_SAFE_TIMEOUT
    );
    const promise = new Promise((resolve) => {
      if (this._closed) {
        resolve({ ok: false, error: "session-closed" });
        return;
      }
      const entry = {
        requestId,
        resolve,
        timer: setTimeout(() => {
          const p = this._pending.get(requestId);
          if (!p) return;
          this._pending.delete(requestId);
          resolve({ ok: false, error: "timeout" });
        }, safeTimeoutMs)
      };
      this._pending.set(requestId, entry);
    });
    return { requestId, promise };
  }
  /** Resolve a pending request when a wallet `response` envelope arrives. */
  resolve(envelope) {
    if (envelope.msg !== "response") return;
    const requestId = envelope.requestId;
    if (!requestId) return;
    const entry = this._pending.get(requestId);
    if (!entry) return;
    this._pending.delete(requestId);
    if (entry.timer) clearTimeout(entry.timer);
    if (envelope.error) {
      entry.resolve({ ok: false, error: envelope.error });
    } else {
      entry.resolve({ ok: true, value: envelope.result });
    }
  }
  /**
   * Reject every in-flight request with the given reason. Typically
   * called with `"session-closed"` from session teardown.
   */
  closeAll(reason) {
    if (this._closed) return;
    this._closed = true;
    for (const entry of this._pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: reason });
    }
    this._pending.clear();
  }
};
function newUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = b[6] & 15 | 64;
  b[8] = b[8] & 63 | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// src/session.ts
var CONNECTION_UNSTABLE_THRESHOLD_MS = 1e3;
var CONNECTION_OFFLINE_AFTER_MS = 5e3;
var PING_INTERVAL_MS = 2e3;
var ACK_RETRY_DELAY_MS = 2e3;
var ACK_MAX_ATTEMPTS = 3;
var SEEN_IDS_CAPACITY = 500;
function _unrefTimer(t) {
  if (t === null) return;
  const maybe = t;
  if (typeof maybe.unref === "function") maybe.unref();
}
function _mapTransportCloseReason(reason) {
  if (reason === "ttl_reached") return "ttl_reached";
  if (reason === "wallet_signed_out") return "wallet_signed_out";
  if (reason === "user_revoked") return "user_revoked";
  if (reason === "credential_revoked") return "credential_revoked";
  return "network_loss";
}
function uuidv4() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = buf[6] & 15 | 64;
  buf[8] = buf[8] & 63 | 128;
  const h = [];
  for (let i = 0; i < 16; i++) h.push(buf[i].toString(16).padStart(2, "0"));
  return h.slice(0, 4).join("") + "-" + h.slice(4, 6).join("") + "-" + h.slice(6, 8).join("") + "-" + h.slice(8, 10).join("") + "-" + h.slice(10, 16).join("");
}
var PrsonLoginSession = class {
  constructor(opts) {
    this._expiryTimer = null;
    this._closed = false;
    /**
     * Wallet's session X25519 public key. Captured from the first
     * inbound envelope's `walletSessionPk`. Null until then — calls
     * to `request()` before it lands resolve with
     * `{ ok: false, error: "no-active-session" }`.
     */
    this._walletSessionPk = null;
    /** Pairs outbound `request` envelopes with inbound `response`s. */
    this._requestController = new RequestController();
    /**
     * Per-`requestId` mouse-update subscribers. Populated by
     * [`bindMouse`] when it opens a `kind: "mouse"` request and torn
     * down when the controller disposes or the wallet's final
     * `response` arrives. Keys are RFC-4122 v4 UUIDs (the request id);
     * values get a stream of decoded `mouse` bodies.
     */
    this._mouseSubscribers = /* @__PURE__ */ new Map();
    /**
     * Ambient mouse-update handler. Used when the wallet starts a
     * mouse stream WITHOUT a prior `kind: "mouse"` request — i.e.
     * the pre-grant flow enabled by [SignInOptions.mouseControl].
     * [`bindMouse`] registers itself here; any inbound
     * `mouse-update` frame whose `requestId` doesn't match a
     * specific subscriber falls through to this handler so the
     * cursor moves regardless of who initiated the stream.
     *
     * Null when no [`bindMouse`] is mounted; only one ambient
     * handler is active at a time (last call wins, mirroring the
     * remote-nav listener semantics).
     */
    this._ambientMouseHandler = null;
    /**
     * File-transfer envelope handler. [`enableRemoteNavigation`]
     * installs one of these to receive `file-begin` / `file-chunk` /
     * `file-end` envelopes and reassemble the bytes into a `File`
     * the focused `<input type="file">` accepts. The session layer
     * just dispatches — assembly logic lives in `bind.ts` so the
     * DOM dependency stays out of the protocol layer.
     */
    this._fileEnvelopeHandler = null;
    /**
     * Remote-navigation listener — installed by
     * [`enableRemoteNavigation`]. Receives every inbound `nav`,
     * `value`, and `logout` envelope. Only one listener at a time
     * (later registrations replace the prior). Null when remote-nav
     * is not active for this session.
     */
    this._remoteNavListener = null;
    /**
     * User's preferred UI language as a BCP-47 tag. Captured from the
     * initial `presentation` envelope's `preferredLanguage` field;
     * updated whenever a fresh envelope arrives with a new value.
     * Null until the first envelope lands. The host page reads this
     * to localise its own UI without an extra round-trip.
     */
    this._preferredLanguage = null;
    /**
     * Public-profile display name (cosmetic — host should treat as
     * untrusted). Seeded from the wallet's initial `presentation`
     * envelope and updated via `display-update` envelopes; mirrored
     * by the `display_name_changed` event.
     */
    this._displayName = null;
    /**
     * Public-profile avatar pointer (cosmetic). Same trust model as
     * `_displayName`. Updated via `display-update` envelopes; mirrored
     * by `avatar_changed`.
     */
    this._avatar = null;
    /** Per-type listener map. */
    this._listeners = /* @__PURE__ */ new Map();
    /** "Fire on every event" subscribers — for logging / telemetry. */
    this._anyListeners = /* @__PURE__ */ new Set();
    // ─── Transport-layer reliability state ───────────────────────────
    //
    // Mirrors the wallet's LoginSession protocol (see
    // mobile-app/.../login_session_service.dart):
    //
    //   * `_seenIds` + `_seenIdsOrder` — LRU dedupe of inbound `id`s.
    //   * `_pendingAcks`               — outbound ack-tracked sends.
    //   * `_pingSendTimes`             — RTT correlation by ping id.
    //   * `_pingTimer` + `_offlineTimer` — liveness loop.
    //
    // Browser-side critical sends are: `request`, `focus`, `ack`,
    // `pong`. Of those only `request` already has its own
    // RequestController/timeout contract; the rest are fire-and-forget
    // today. To keep the surface small AND match the wallet, we add
    // ack tracking on outbound `focus` only (high signal-to-noise for
    // remote-nav UX). `request` keeps its existing semantics; `ack`
    // and `pong` are never themselves ack-tracked (would loop).
    this._seenIds = /* @__PURE__ */ new Set();
    this._seenIdsOrder = [];
    this._pendingAcks = /* @__PURE__ */ new Map();
    this._pingSendTimes = /* @__PURE__ */ new Map();
    this._pingTimer = null;
    this._offlineTimer = null;
    this._connectionStatus = "unknown";
    this._lastRttMs = null;
    this._connectionListeners = /* @__PURE__ */ new Set();
    /**
     * `pagehide` handler reference. Held so we can deregister at
     * teardown without anchoring `this` to the global listener
     * forever — important because the SDK can outlive multiple
     * sign-in / sign-out cycles in a single tab.
     */
    this._onPageHide = null;
    this._cnf = opts.cnf;
    this._expiresAt = opts.credential.expiresAt;
    this._transport = opts.transport;
    this._ephKeys = opts.ephKeys;
    this._verifierContext = opts.verifierContext;
    this._claimsSnapshot = { ...opts.initialClaims ?? {} };
    this._walletSessionPk = opts.walletSessionPk ?? null;
    this._preferredLanguage = opts.initialPreferredLanguage ?? null;
    this._displayName = opts.initialDisplayName ?? null;
    this._avatar = opts.initialAvatar ?? null;
    this._armExpiryTimer();
    this._installUnloadGuard();
    this._transport.onMessage((raw) => void this._handleMessage(raw));
    this._transport.onClose((reason) => {
      if (this._closed) return;
      const mapped = _mapTransportCloseReason(reason);
      this._teardown(mapped);
    });
    this._pingTimer = setInterval(() => this._sendPing(), PING_INTERVAL_MS);
    _unrefTimer(this._pingTimer);
    if (opts.initialSignedInResult) {
      const result = opts.initialSignedInResult;
      queueMicrotask(() => this._dispatch({ type: "signed_in", result }));
    }
  }
  // ─── Public getters ──────────────────────────────────────────────
  get expiresAt() {
    return this._expiresAt;
  }
  get cnf() {
    return this._cnf;
  }
  /** Snapshot of the most recent verified claims (since last renew / update). */
  get claims() {
    return this._claimsSnapshot;
  }
  /** User's preferred UI language (BCP-47 tag) or null if the
   *  wallet hasn't published one yet. */
  get preferredLanguage() {
    return this._preferredLanguage;
  }
  /** Public-profile display name from the wallet's identity record,
   *  or null if the wallet hasn't published one yet (anonymous
   *  identity, etc.). Cosmetic — do not gate privileged actions on
   *  this value. */
  get displayName() {
    return this._displayName;
  }
  /** Public-profile avatar pointer, or null. Same cosmetic-only
   *  trust model as [displayName]. */
  get avatar() {
    return this._avatar;
  }
  /** Coarse health of the wallet ↔ browser data channel as observed
   *  via the periodic ping/pong loop. `unknown` until the first pong
   *  lands; `offline` after 5 s of no pong; `unstable` when the most
   *  recent RTT crossed 1 s; otherwise `stable`. */
  get connectionStatus() {
    return this._connectionStatus;
  }
  /** Most recently observed RTT in milliseconds, or null until the
   *  first pong lands. */
  get lastRttMs() {
    return this._lastRttMs;
  }
  /** Subscribe to connection-status changes. Fires on every transition
   *  with the new status + the RTT that triggered it (null on the
   *  `offline` transition). Returns an unsubscribe handle. */
  onConnectionStatus(cb) {
    this._connectionListeners.add(cb);
    return () => this._connectionListeners.delete(cb);
  }
  // ─── Subscription API ────────────────────────────────────────────
  /**
   * Subscribe to a single event type. The callback is invoked with
   * the typed event variant (TS narrows on the `type` discriminant).
   * Returns an unsubscribe handle.
   *
   *   const off = session.on("claim_updated", (e) => {
   *     if (e.name === "verification_level") refreshBadge(e.newValue);
   *   });
   *   // later:
   *   off();
   */
  on(type, cb) {
    let set = this._listeners.get(type);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this._listeners.set(type, set);
    }
    const wrapped = cb;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }
  /** Subscribe to every event. Returns an unsubscribe handle. */
  onAny(cb) {
    this._anyListeners.add(cb);
    return () => this._anyListeners.delete(cb);
  }
  // ─── Back-compat shims ───────────────────────────────────────────
  //
  // The original SDK exposed `onRenewed(cb)` and `onExpiry(cb)`.
  // We keep them as thin wrappers around the typed `on()` so
  // existing host pages compile without changes. New code should
  // prefer `on()` / `onAny()`.
  /** @deprecated Use `on("renewed", e => cb(e.result))` instead. */
  onRenewed(cb) {
    return this.on("renewed", (e) => cb(e.result));
  }
  /** @deprecated Use `on("signed_out", e => cb(e.reason))` instead. */
  onExpiry(cb) {
    return this.on("signed_out", (e) => cb(e.reason));
  }
  close() {
    this._teardown("user_revoked");
  }
  // ─── Request channel ─────────────────────────────────────────────
  /**
   * Send a [request] to the wallet and resolve with the wallet's
   * reply. The wallet shows a bottom drawer for the user to
   * approve / decline / pick a matching fragment or document; the
   * promise resolves when the user acts (or the [timeoutMs]
   * elapses, or the session closes).
   *
   * Common error codes:
   *   * `no-active-session` — request issued before the wallet has
   *      published its session pk (race against the initial
   *      `presentation` envelope) or after the session closed.
   *   * `declined` — user tapped Decline in the wallet drawer.
   *   * `not-present` — no matching fragment / document on the
   *      device AND the user declined to acquire one.
   *   * `queue-full` — wallet is sitting at the 5-in-flight cap and
   *      isn't accepting more requests. Try later.
   *   * `rate-limited` — wallet's 1-request-per-second throttle
   *      rejected this one.
   *   * `timeout` — the [timeoutMs] elapsed before the wallet
   *      replied. Defaults to 60 s.
   *   * `session-closed` — the session shut down with this request
   *      in flight.
   *
   * Wire grammar: outbound envelope shape is
   * `{ v, msg: "request", issuedAt, domain, requestId, kind, ...kindFields }`,
   * NaCl-boxed to the wallet's session pk. Reply is a matching
   * `{ msg: "response", requestId, result | error }`.
   */
  async request(req, opts) {
    return this._sendRequest(req, opts);
  }
  /**
   * Streaming variant of [request] for `kind: "mouse"`. Identical
   * to `request()` except [onFrame] is invoked for every
   * `mouse-update` envelope the wallet emits against the request's
   * UUID until the terminating `response` arrives. The returned
   * promise resolves with the final response (i.e. when the user
   * closes the wallet drawer). Used by [`bindMouse`].
   *
   * Separated from `request()` because the subscriber MUST be
   * attached against the requestId BEFORE the envelope is sent —
   * otherwise the first `mouse-update` frame can race ahead of the
   * subscription. `request()` doesn't expose its requestId, so we
   * provide this dedicated entry point rather than leak the id.
   */
  async requestMouse(req, onFrame, opts) {
    return this._sendRequest(req, opts, onFrame);
  }
  /**
   * Push the currently-focused input's metadata + value to the
   * wallet so the user can edit it on the phone. Pass `null` to
   * clear the wallet's focus mirror (blur, page change, etc.).
   *
   * Used by [`enableRemoteNavigation`]; not part of the documented
   * public API but exposed so the helper lives in a separate module
   * without reaching into private fields. NaCl-boxed to the wallet's
   * session pk on the way out.
   *
   * @internal
   */
  async _sendFocus(focus) {
    if (this._closed) return;
    if (!this._walletSessionPk) return;
    await this._sendWithAck({
      msg: "focus",
      focus
    });
  }
  /**
   * Install a `pagehide` listener that fires a synchronous
   * `browser-revoke` envelope at the wallet right before the tab
   * closes / refreshes / navigates away. Without this the wallet
   * has to wait for the slower transport-collapse pathway
   * (`peer-gone` over the signaling WS + ICE failure on the data
   * channel) to learn the browser is gone — long enough for the
   * connection-status dot to oscillate and any in-flight ack
   * promises to time out.
   *
   * `pagehide` is preferred over `beforeunload` because:
   *   * it fires for bfcache evictions (back/forward navigation
   *     on iOS Safari), tab closes, AND refreshes
   *   * `beforeunload` is increasingly restricted by browsers
   *     for non-blocking-prompt use
   *
   * The envelope itself rides through the same NaCl box as every
   * other browser→wallet message. We can't await the ack — the
   * page is being torn down — so this is a true fire-and-forget;
   * the wallet's [LoginSession.inbound] handler treats receipt
   * as the trigger to close.
   */
  _installUnloadGuard() {
    if (typeof window === "undefined") return;
    this._onPageHide = (_e) => {
      if (this._closed || !this._walletSessionPk) return;
      const body = JSON.stringify({
        v: "prson_vp_v1",
        msg: "browser-revoke",
        issuedAt: Math.floor(Date.now() / 1e3),
        domain: this._verifierContext.expectedAudience.replace(/^https?:\/\//, ""),
        reason: "page_unload"
      });
      try {
        this._transport.send(boxToWallet(this._walletSessionPk, body));
      } catch {
      }
    };
    window.addEventListener("pagehide", this._onPageHide);
  }
  /**
   * Browser→wallet pause-state notification. The wallet's mouse
   * controller dims its surface + shows "Remote control paused"
   * while the page is in the background. Fire-and-forget over
   * NaCl-box to the wallet's session pk; loss is acceptable
   * (we re-fire on every focus / blur).
   *
   * @internal
   */
  async _sendControlStatus(paused) {
    if (this._closed) return;
    if (!this._walletSessionPk) return;
    const payload = JSON.stringify({
      v: "prson_vp_v1",
      msg: "control-status",
      issuedAt: Math.floor(Date.now() / 1e3),
      domain: this._verifierContext.expectedAudience.replace(/^https?:\/\//, ""),
      paused
    });
    try {
      this._transport.send(boxToWallet(this._walletSessionPk, payload));
    } catch {
    }
  }
  /**
   * Install the ambient `mouse-update` handler. Mirrors
   * [`_setRemoteNavListener`] — only one ambient subscriber at a
   * time (last call wins). Used by [`bindMouse`] when the
   * session was pre-granted mouse control at sign-in
   * ([SignInOptions.mouseControl]).
   *
   * @internal
   */
  _setAmbientMouseHandler(cb) {
    this._ambientMouseHandler = cb;
    return () => {
      if (this._ambientMouseHandler === cb) this._ambientMouseHandler = null;
    };
  }
  /**
   * Install the file-envelope handler. Mirrors
   * [`_setAmbientMouseHandler`] — only one handler at a time;
   * [`enableRemoteNavigation`] owns it during its lifetime and
   * tears it down on disposal so the next mount can install a
   * fresh one. The handler receives `file-begin` / `file-chunk` /
   * `file-end` envelopes in arrival order; assembly + DOM
   * dispatch lives in [`bind.ts`].
   *
   * @internal
   */
  _setFileEnvelopeHandler(cb) {
    this._fileEnvelopeHandler = cb;
    return () => {
      if (this._fileEnvelopeHandler === cb) this._fileEnvelopeHandler = null;
    };
  }
  /**
   * Install the remote-navigation listener. Replaces any prior
   * listener — only one is active at a time. Returns an unsubscribe
   * handle. Used by [`enableRemoteNavigation`].
   *
   * @internal
   */
  _setRemoteNavListener(cb) {
    this._remoteNavListener = cb;
    return () => {
      if (this._remoteNavListener === cb) this._remoteNavListener = null;
    };
  }
  async _sendRequest(req, opts, onMouseFrame) {
    if (this._closed) return { ok: false, error: "session-closed" };
    const recipientPk = this._walletSessionPk;
    if (!recipientPk) return { ok: false, error: "no-active-session" };
    const timeoutMs = opts?.timeoutMs ?? 6e4;
    const { requestId, promise } = this._requestController.enqueue(timeoutMs);
    if (onMouseFrame) this._mouseSubscribers.set(requestId, onMouseFrame);
    const envelope = {
      v: "prson_vp_v1",
      msg: "request",
      issuedAt: Math.floor(Date.now() / 1e3),
      domain: this._verifierContext.expectedAudience.replace(/^https?:\/\//, ""),
      requestId,
      kind: req.kind
    };
    switch (req.kind) {
      case "claim-value":
        envelope.name = req.name;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "fragment-check":
        envelope.fragmentName = req.fragmentName;
        if (req.format) envelope.format = req.format;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "document-presence":
        if (req.type) envelope.type = req.type;
        if (req.country) envelope.country = req.country;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "document-sign":
        if ("bytes" in req.document) {
          envelope.document = {
            bytes: u8ToB64(req.document.bytes)
          };
        } else {
          envelope.document = req.document;
        }
        if (req.visibleCue) envelope.visibleCue = req.visibleCue;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "input":
        envelope.inputType = req.inputType;
        envelope.label = req.label;
        if (req.placeholder !== void 0) envelope.placeholder = req.placeholder;
        if (req.defaultValue !== void 0) envelope.defaultValue = req.defaultValue;
        if (req.minLength !== void 0) envelope.minLength = req.minLength;
        if (req.maxLength !== void 0) envelope.maxLength = req.maxLength;
        if (req.min !== void 0) envelope.min = req.min;
        if (req.max !== void 0) envelope.max = req.max;
        if (req.pattern !== void 0) envelope.pattern = req.pattern;
        if (req.required !== void 0) envelope.required = req.required;
        if (req.options !== void 0) envelope.options = req.options;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "input-form":
        envelope.fields = req.fields;
        if (req.submitLabel !== void 0) envelope.submitLabel = req.submitLabel;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "mouse":
        envelope.mode = req.mode;
        if (req.reason) envelope.reason = req.reason;
        break;
    }
    try {
      const boxed = boxToWallet(recipientPk, JSON.stringify(envelope));
      this._transport.send(boxed);
    } catch {
      if (onMouseFrame) this._mouseSubscribers.delete(requestId);
      return { ok: false, error: "session-closed" };
    }
    return promise;
  }
  // ─── internals ───────────────────────────────────────────────────
  /**
   * Fire a single event to per-type listeners + onAny subscribers.
   * Listener errors are swallowed so one buggy host listener can't
   * break the rest of the dispatch (or close the session).
   */
  _dispatch(event) {
    const set = this._listeners.get(event.type);
    if (set) {
      for (const cb of set) {
        try {
          cb(event);
        } catch {
        }
      }
    }
    for (const cb of this._anyListeners) {
      try {
        cb(event);
      } catch {
      }
    }
  }
  _armExpiryTimer() {
    if (this._expiryTimer) clearTimeout(this._expiryTimer);
    const delta = this._expiresAt - Date.now();
    const skewBudgetMs = 6e4;
    if (this._expiresAt <= 0 || Math.abs(delta) < skewBudgetMs) {
      console.warn(
        `[@prson/login-sdk] credential expiresAt ${this._expiresAt <= 0 ? "missing/zero" : delta < 0 ? `${(-delta / 1e3).toFixed(1)}s in the past` : `only ${(delta / 1e3).toFixed(1)}s in the future`} \u2014 leaving session open without a TTL timer. Host should set its own deadline.`
      );
      return;
    }
    if (delta <= 0) {
      this._teardown("ttl_reached");
      return;
    }
    const MAX_TIMEOUT = 2147483e3;
    const chunk = delta > MAX_TIMEOUT ? MAX_TIMEOUT : delta;
    this._expiryTimer = setTimeout(() => {
      if (this._closed) return;
      if (Date.now() >= this._expiresAt) {
        this._teardown("ttl_reached");
      } else {
        this._armExpiryTimer();
      }
    }, chunk);
    _unrefTimer(this._expiryTimer);
  }
  async _handleMessage(raw) {
    if (this._closed) return;
    let envelope;
    try {
      envelope = await decryptEnvelope(raw, this._ephKeys);
    } catch {
      return;
    }
    if (typeof envelope.id === "string") {
      if (this._seenIds.has(envelope.id)) {
        void this._sendAckFor(envelope);
        return;
      }
      this._markSeen(envelope.id);
      void this._sendAckFor(envelope);
    }
    if (envelope.msg === "ack") {
      this._handleAck(envelope.ackOf);
      return;
    }
    if (envelope.msg === "ping") {
      void this._sendPong(envelope);
      return;
    }
    if (envelope.msg === "pong") {
      this._handlePong(envelope);
      return;
    }
    await this._dispatchDecryptedForTest(envelope);
  }
  // ─── Transport-layer protocol helpers ─────────────────────────────
  _markSeen(id) {
    this._seenIds.add(id);
    this._seenIdsOrder.push(id);
    if (this._seenIdsOrder.length > SEEN_IDS_CAPACITY) {
      const evict = this._seenIdsOrder.shift();
      if (evict) this._seenIds.delete(evict);
    }
  }
  /** Auto-ack any inbound envelope that carries an `id`, except
   *  protocol primitives. `ping` is implicitly acked by `pong`;
   *  `pong` and `ack` would loop. */
  async _sendAckFor(envelope) {
    if (typeof envelope.id !== "string") return;
    if (envelope.msg === "ack" || envelope.msg === "ping" || envelope.msg === "pong") {
      return;
    }
    if (!this._walletSessionPk) return;
    const body = JSON.stringify({
      v: "prson_vp_v1",
      msg: "ack",
      ackOf: envelope.id,
      issuedAt: Math.floor(Date.now() / 1e3),
      domain: this._verifierContext.expectedAudience.replace(/^https?:\/\//, "")
    });
    try {
      this._transport.send(boxToWallet(this._walletSessionPk, body));
    } catch {
    }
  }
  _handleAck(ackOf) {
    if (!ackOf) return;
    const pending = this._pendingAcks.get(ackOf);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this._pendingAcks.delete(ackOf);
  }
  async _sendPing() {
    if (this._closed) return;
    if (!this._walletSessionPk) return;
    const id = uuidv4();
    const ts = Date.now();
    this._pingSendTimes.set(id, ts);
    const body = JSON.stringify({
      v: "prson_vp_v1",
      msg: "ping",
      id,
      ts,
      domain: this._verifierContext.expectedAudience.replace(/^https?:\/\//, "")
    });
    try {
      this._transport.send(boxToWallet(this._walletSessionPk, body));
    } catch {
    }
    this._armOfflineTimer();
  }
  async _sendPong(ping) {
    if (!this._walletSessionPk) return;
    if (typeof ping.id !== "string") return;
    const body = JSON.stringify({
      v: "prson_vp_v1",
      msg: "pong",
      ackOf: ping.id,
      ts: ping.ts,
      recvTs: Date.now(),
      domain: this._verifierContext.expectedAudience.replace(/^https?:\/\//, "")
    });
    try {
      this._transport.send(boxToWallet(this._walletSessionPk, body));
    } catch {
    }
  }
  _handlePong(envelope) {
    if (typeof envelope.ackOf !== "string") return;
    const sent = this._pingSendTimes.get(envelope.ackOf);
    if (sent === void 0) return;
    this._pingSendTimes.delete(envelope.ackOf);
    const rtt = Date.now() - sent;
    this._lastRttMs = rtt;
    if (this._offlineTimer) {
      clearTimeout(this._offlineTimer);
      this._offlineTimer = null;
    }
    this._setConnectionStatus(
      rtt > CONNECTION_UNSTABLE_THRESHOLD_MS ? "unstable" : "stable",
      rtt
    );
  }
  _armOfflineTimer() {
    if (this._offlineTimer) clearTimeout(this._offlineTimer);
    this._offlineTimer = setTimeout(() => {
      if (this._closed) return;
      this._setConnectionStatus("offline", null);
    }, CONNECTION_OFFLINE_AFTER_MS);
    _unrefTimer(this._offlineTimer);
  }
  _setConnectionStatus(s, rttMs) {
    if (this._connectionStatus === s && this._lastRttMs === rttMs) return;
    this._connectionStatus = s;
    if (rttMs !== null) this._lastRttMs = rttMs;
    for (const cb of this._connectionListeners) {
      try {
        cb(s, rttMs);
      } catch {
      }
    }
  }
  /** Send a JSON envelope with ack tracking + retry. Stamps a fresh
   *  `id` onto [body] and retransmits every [ACK_RETRY_DELAY_MS]
   *  until the matching ack lands or [ACK_MAX_ATTEMPTS] is reached.
   *  Resolves with `true` on ack, `false` on exhaustion. */
  async _sendWithAck(body) {
    if (this._closed) return false;
    if (!this._walletSessionPk) return false;
    const id = uuidv4();
    body.id = id;
    body.v = body.v ?? "prson_vp_v1";
    body.issuedAt = body.issuedAt ?? Math.floor(Date.now() / 1e3);
    body.domain = body.domain ?? this._verifierContext.expectedAudience.replace(/^https?:\/\//, "");
    const encoded = JSON.stringify(body);
    const pending = { encoded, attempts: 0, timer: null };
    this._pendingAcks.set(id, pending);
    return new Promise((resolve) => {
      const attempt = () => {
        if (this._closed) {
          this._pendingAcks.delete(id);
          resolve(false);
          return;
        }
        pending.attempts += 1;
        try {
          this._transport.send(boxToWallet(this._walletSessionPk, encoded));
        } catch {
        }
        pending.timer = setTimeout(() => {
          if (!this._pendingAcks.has(id)) {
            resolve(true);
            return;
          }
          if (pending.attempts >= ACK_MAX_ATTEMPTS) {
            this._pendingAcks.delete(id);
            resolve(false);
            return;
          }
          attempt();
        }, ACK_RETRY_DELAY_MS);
        _unrefTimer(pending.timer);
      };
      attempt();
    });
  }
  /**
   * Pure dispatch entry-point — takes an already-decrypted envelope
   * and routes it through the same per-message handlers
   * `_handleMessage` does after decryption. Public-but-prefixed so
   * unit tests can exercise the dispatch contract without
   * constructing real NaCl-boxed ciphertext.
   *
   * NOT part of the documented public API; treat as @internal.
   */
  async _dispatchDecryptedForTest(envelope) {
    if (this._closed) return;
    if (typeof envelope.walletSessionPk === "string") {
      this._walletSessionPk = envelope.walletSessionPk;
    }
    if (typeof envelope.preferredLanguage === "string") {
      this._preferredLanguage = envelope.preferredLanguage;
    }
    switch (envelope.msg) {
      case "revoke":
        this._teardown("wallet_signed_out");
        return;
      case "presentation":
      case "renewal":
        await this._handleRenewal(envelope);
        return;
      case "claim-update":
        await this._handleClaimUpdate(envelope);
        return;
      case "display-update":
        this._handleDisplayUpdate(envelope);
        return;
      case "credential-revoked":
        this._handleCredentialRevoked(envelope);
        return;
      case "response":
        this._requestController.resolve(envelope);
        if (envelope.requestId) this._mouseSubscribers.delete(envelope.requestId);
        return;
      case "mouse-update":
        if (envelope.mouse) {
          const perRequest = envelope.requestId ? this._mouseSubscribers.get(envelope.requestId) : void 0;
          const target = perRequest ?? this._ambientMouseHandler;
          if (target) {
            try {
              target(envelope.mouse);
            } catch {
            }
          }
        }
        return;
      case "nav":
      case "logout":
        if (this._remoteNavListener) {
          try {
            if (envelope.msg === "nav" && envelope.action) {
              this._remoteNavListener({ msg: "nav", action: envelope.action });
              return;
            }
            if (envelope.msg === "logout") {
              this._remoteNavListener({ msg: "logout" });
              this._teardown("user_revoked");
              return;
            }
          } catch {
          }
        }
        if (envelope.msg === "logout") this._teardown("user_revoked");
        return;
      case "value":
        if (this._remoteNavListener && typeof envelope.value === "string") {
          try {
            this._remoteNavListener({ msg: "value", value: envelope.value });
          } catch {
          }
        }
        return;
      case "file-begin":
      case "file-chunk":
      case "file-end":
        if (this._fileEnvelopeHandler) {
          try {
            this._fileEnvelopeHandler(envelope);
          } catch {
          }
        }
        return;
      default:
        return;
    }
  }
  async _handleRenewal(envelope) {
    if (!envelope.presentation) return;
    const verifierOpts = {
      ...this._verifierContext,
      expectedNonce: extractKbNonce(envelope.presentation) ?? this._verifierContext.expectedNonceFactory()
    };
    const verified = await verifyPresentation(
      envelope.presentation,
      verifierOpts
    );
    if (!verified.ok) return;
    if (verified.cnf.jwk.x !== this._cnf.jwk.x) return;
    this._expiresAt = verified.credential.expiresAt;
    this._claimsSnapshot = { ...verified.claims };
    this._armExpiryTimer();
    const fresh = {
      sdJwtVc: envelope.presentation,
      // The wallet picks a renewal's nonce, so a backend can't have issued it.
      nonce: String(verifierOpts.expectedNonce),
      claims: verified.claims,
      cnf: verified.cnf,
      credential: verified.credential,
      session: this
    };
    this._dispatch({ type: "renewed", result: fresh });
  }
  /**
   * Verify the embedded presentation, then diff its claims against
   * the cached snapshot and emit name-only per-claim events. The
   * actual claim values land in `this._claimsSnapshot` (accessible
   * via `session.claims`) but **never** in the event payloads —
   * see the privacy note on the [LoginEvent] type.
   *
   * Re-verifies against the same audience + accepted-VCT set as the
   * initial sign-in. A `claim-update` whose presentation fails
   * verification is dropped silently — fail-closed. Same for a
   * cnf-mismatch (the wallet swapped per-domain key under us).
   *
   * The wire-level `envelope.delta` is intentionally ignored — we
   * recompute the diff from the verified SD-JWT so a malicious
   * wallet can't lie about which claim changed. The wallet should
   * not include values in `envelope.delta` at all (the wire
   * grammar in `crypto.ts` documents this as name-only); we'd
   * ignore them even if it did.
   */
  async _handleClaimUpdate(envelope) {
    if (!envelope.presentation) return;
    const verifierOpts = {
      ...this._verifierContext,
      expectedNonce: extractKbNonce(envelope.presentation) ?? this._verifierContext.expectedNonceFactory()
    };
    const verified = await verifyPresentation(
      envelope.presentation,
      verifierOpts
    );
    if (!verified.ok) return;
    if (verified.cnf.jwk.x !== this._cnf.jwk.x) return;
    const oldClaims = this._claimsSnapshot;
    const newClaims = verified.claims;
    this._claimsSnapshot = { ...newClaims };
    for (const [name, newValue] of Object.entries(newClaims)) {
      if (!(name in oldClaims)) {
        this._dispatch({
          type: "claim_added",
          name,
          newHash: await canonicalSha256Hex(newValue)
        });
      } else if (!_deepEqual(oldClaims[name], newValue)) {
        this._dispatch({
          type: "claim_updated",
          name,
          newHash: await canonicalSha256Hex(newValue)
        });
      }
    }
    for (const name of Object.keys(oldClaims)) {
      if (!(name in newClaims)) {
        this._dispatch({ type: "claim_removed", name });
      }
    }
  }
  /**
   * Display-only update. Fires `display_name_changed` and/or
   * `avatar_changed` based on which fields the envelope carries.
   * NOT cryptographically verified — partner sites should treat
   * the payload as advisory (refresh the cosmetic UI) and not
   * grant any privileged access on the basis of these values.
   */
  _handleDisplayUpdate(envelope) {
    if (envelope.displayName !== void 0) {
      this._displayName = envelope.displayName;
      this._dispatch({
        type: "display_name_changed",
        displayName: envelope.displayName
      });
    }
    if (envelope.avatar !== void 0) {
      this._avatar = envelope.avatar;
      this._dispatch({ type: "avatar_changed", avatar: envelope.avatar });
    }
  }
  /**
   * Credential-revoked. Fires `credential_revoked` with the
   * wallet-supplied reason, then tears the session down with
   * `signed_out / reason="credential_revoked"`. Both events land
   * before the transport closes.
   */
  _handleCredentialRevoked(envelope) {
    const reason = envelope.reason ?? "user_revoked";
    this._dispatch({ type: "credential_revoked", reason });
    this._teardown("credential_revoked");
  }
  _teardown(reason) {
    if (this._closed) return;
    this._closed = true;
    if (this._expiryTimer) clearTimeout(this._expiryTimer);
    if (this._pingTimer) clearInterval(this._pingTimer);
    if (this._offlineTimer) clearTimeout(this._offlineTimer);
    if (this._onPageHide && typeof window !== "undefined") {
      window.removeEventListener("pagehide", this._onPageHide);
      this._onPageHide = null;
    }
    for (const p of this._pendingAcks.values()) {
      if (p.timer) clearTimeout(p.timer);
    }
    this._pendingAcks.clear();
    this._pingSendTimes.clear();
    try {
      this._transport.close();
    } catch {
    }
    this._requestController.closeAll("session-closed");
    this._mouseSubscribers.clear();
    this._dispatch({ type: "signed_out", reason });
    this._listeners.clear();
    this._anyListeners.clear();
    this._connectionListeners.clear();
  }
};
function extractKbNonce(presentation) {
  const parts = presentation.split("~");
  const last = parts[parts.length - 1];
  if (!last || !last.includes(".")) return void 0;
  const [, kbP] = last.split(".");
  if (!kbP) return void 0;
  try {
    const pad = (4 - kbP.length % 4) % 4;
    const std = (kbP + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(std));
    return decoded.nonce;
  } catch {
    return void 0;
  }
}
function u8ToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function canonicalJson(value) {
  if (value === void 0) return "null";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
  }
  return JSON.stringify(String(value));
}
async function canonicalSha256Hex(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}
function _deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// src/api.ts
async function createDraft(request, opts = {}) {
  const base = opts.signalingBase ?? SIGNALING_BASE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${base}/session/draft`, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request })
  });
  if (!res.ok) {
    const text = await safeText(res);
    if (res.status === 429) {
      throw new Error("Too many login sessions from this network \u2014 please retry shortly.");
    }
    throw new Error(`createDraft failed: HTTP ${res.status} ${text || res.statusText}`);
  }
  return await res.json();
}
async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// src/signaling.ts
var WS_SUBPROTOCOL = "prson-login-v1";
async function connectSignaling(opts) {
  const ws = new WebSocket(opts.url, [WS_SUBPROTOCOL, opts.sigToken]);
  const msgListeners = [];
  const closeListeners = [];
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onErrorBefore);
      resolve();
    };
    const onErrorBefore = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onErrorBefore);
      reject(new Error("signaling: WS upgrade failed (auth?)"));
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onErrorBefore);
  });
  ws.addEventListener("message", (evt) => {
    let parsed;
    try {
      parsed = JSON.parse(String(evt.data));
    } catch {
      return;
    }
    for (const cb of msgListeners) cb(parsed);
  });
  ws.addEventListener("close", (evt) => {
    const reason = evt.reason || `code-${evt.code}`;
    for (const cb of closeListeners) cb(reason);
  });
  return {
    send(m) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(m));
    },
    onMessage(cb) {
      msgListeners.push(cb);
    },
    onClose(cb) {
      closeListeners.push(cb);
    },
    close() {
      try {
        ws.close(1e3, "client_close");
      } catch {
      }
    }
  };
}

// src/transport.ts
async function establishTransport(opts) {
  const iceServers = [
    // Cloudflare STUN (free, no auth) — lets the browser gather host
    // + server-reflexive candidates so the wallet has somewhere to
    // connect even when both sides start from behind NAT.
    { urls: "stun:stun.cloudflare.com:3478" }
  ];
  if (opts.turn) {
    iceServers.push({
      urls: opts.turn.urls,
      username: opts.turn.username,
      credential: opts.turn.credential
    });
  }
  const pc = new RTCPeerConnection({ iceServers });
  const dc = pc.createDataChannel("prson-login", { ordered: true });
  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) opts.signaling.send({ msg: "candidate", candidate: e.candidate.toJSON() });
  });
  opts.signaling.onMessage(async (m) => {
    if (m.msg === "answer") {
      await pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
    } else if (m.msg === "candidate") {
      try {
        await pc.addIceCandidate(m.candidate);
      } catch {
      }
    } else if (m.msg === "peer-gone") {
      fireClose("wallet_signed_out");
      try {
        dc.close();
      } catch {
      }
    }
  });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  opts.signaling.send({ msg: "offer", sdp: offer.sdp });
  await new Promise((resolve, reject) => {
    if (dc.readyState === "open") return resolve();
    const onOpen = () => {
      dc.removeEventListener("open", onOpen);
      dc.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      dc.removeEventListener("open", onOpen);
      dc.removeEventListener("error", onError);
      reject(new Error("transport: data channel failed to open"));
    };
    dc.addEventListener("open", onOpen);
    dc.addEventListener("error", onError);
  });
  const oneShotWaiters = [];
  const allListeners = [];
  const closeListeners = [];
  let closeFired = false;
  function fireClose(reason) {
    if (closeFired) return;
    closeFired = true;
    for (const cb of closeListeners) {
      try {
        cb(reason);
      } catch {
      }
    }
  }
  opts.signaling.onClose((reason) => fireClose(reason));
  dc.addEventListener("close", () => fireClose("network_loss"));
  dc.addEventListener("message", (evt) => {
    const raw = typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data);
    while (oneShotWaiters.length > 0) {
      const cb = oneShotWaiters.shift();
      cb(raw);
    }
    for (const cb of allListeners) cb(raw);
  });
  return {
    awaitNextMessage() {
      return new Promise((resolve) => oneShotWaiters.push(resolve));
    },
    awaitFirstMessage() {
      return new Promise((resolve) => oneShotWaiters.push(resolve));
    },
    onMessage(cb) {
      allListeners.push(cb);
    },
    onClose(cb) {
      if (closeFired) {
        queueMicrotask(() => cb("network_loss"));
      } else {
        closeListeners.push(cb);
      }
    },
    send(raw) {
      if (dc.readyState === "open") dc.send(raw);
    },
    close() {
      try {
        dc.close();
      } catch {
      }
      try {
        pc.close();
      } catch {
      }
      opts.signaling.close();
    }
  };
}

// src/qr.ts
function createModalQrMount(opts) {
  const scrim = document.createElement("div");
  scrim.setAttribute("data-prson-login-modal", "1");
  scrim.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;";
  const mount = document.createElement("div");
  mount.setAttribute("data-prson-login-modal-mount", "1");
  mount.style.cssText = "display:flex;align-items:center;justify-content:center;";
  scrim.append(mount);
  document.body.append(scrim);
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
  }
  function onKey(e) {
    if (e.key === "Escape" || e.key === "Esc") {
      e.preventDefault();
      e.stopPropagation();
      opts.onDismiss();
    }
  }
  scrim.addEventListener("click", (e) => {
    if (e.target === scrim || e.target === mount) {
      opts.onDismiss();
    }
  });
  document.addEventListener("keydown", onKey, true);
  return { mount, dispose };
}
function renderLoginQr(url, mount, theme) {
  const override = window.__prsonLoginQrRenderer;
  if (override) return override(url, mount, theme);
  console.warn(
    "[@prson/login-sdk] No QR renderer installed. Set window.__prsonLoginQrRenderer to a function (url, mount, theme) => { dispose: () => void } before calling signIn()."
  );
  const root = document.createElement("div");
  root.setAttribute("data-prson-qr-fallback", "1");
  root.style.cssText = "font-family:system-ui,sans-serif;font-size:12px;padding:12px;border:1px dashed currentColor;border-radius:8px;word-break:break-all;cursor:pointer;";
  root.textContent = url;
  root.title = "Click to copy. Install a real QR renderer for the production UX.";
  root.addEventListener("click", () => {
    void navigator.clipboard?.writeText(url);
  });
  mount.append(root);
  return {
    dispose() {
      root.remove();
    }
  };
}

// src/select_overlay.ts
var activeOverlay = null;
function isSelectOverlayActive() {
  return activeOverlay !== null;
}
function closeAllOverlays() {
  activeOverlay?.close();
}
function openSelectOverlay(select) {
  if (activeOverlay) activeOverlay.close();
  const host = document.createElement("div");
  host.setAttribute("data-prson-select-overlay", "");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "2147483646";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);
  const title = pickTitle(select);
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.setAttribute("data-prson-select-backdrop", "");
  const panel = document.createElement("div");
  panel.className = "panel";
  const header = document.createElement("div");
  header.className = "header";
  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = title;
  const closeBtn = document.createElement("button");
  closeBtn.className = "close";
  closeBtn.setAttribute("type", "button");
  closeBtn.setAttribute("data-prson-select-close", "");
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "\u2715";
  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  panel.appendChild(header);
  const optionsWrap = document.createElement("div");
  optionsWrap.className = "options-wrap";
  const pageUp = document.createElement("button");
  pageUp.className = "page-btn";
  pageUp.setAttribute("type", "button");
  pageUp.setAttribute("data-prson-select-page", "up");
  pageUp.innerHTML = '<span class="chev">\u25B2</span> Previous';
  const list = document.createElement("div");
  list.className = "options-list";
  const pageDown = document.createElement("button");
  pageDown.className = "page-btn";
  pageDown.setAttribute("type", "button");
  pageDown.setAttribute("data-prson-select-page", "down");
  pageDown.innerHTML = 'Next <span class="chev">\u25BC</span>';
  optionsWrap.appendChild(pageUp);
  optionsWrap.appendChild(list);
  optionsWrap.appendChild(pageDown);
  panel.appendChild(optionsWrap);
  backdrop.appendChild(panel);
  shadow.appendChild(backdrop);
  const options = Array.from(select.options);
  const PAGE_SIZE = 6;
  const numPages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
  let currentPage = pageOfValue(select.value, options, PAGE_SIZE);
  function renderPage() {
    list.replaceChildren();
    const start = currentPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, options.length);
    for (let i = start; i < end; i++) {
      const opt = options[i];
      const btn = document.createElement("button");
      btn.className = "option";
      btn.setAttribute("type", "button");
      btn.setAttribute("data-prson-select-option", String(i));
      btn.textContent = opt.label || opt.value || `Option ${i + 1}`;
      if (opt.value === select.value) {
        btn.setAttribute("data-selected", "");
      }
      list.appendChild(btn);
    }
    if (currentPage <= 0) {
      pageUp.setAttribute("disabled", "");
    } else {
      pageUp.removeAttribute("disabled");
    }
    if (currentPage >= numPages - 1) {
      pageDown.setAttribute("disabled", "");
    } else {
      pageDown.removeAttribute("disabled");
    }
  }
  renderPage();
  const handle = {
    host,
    shadow,
    close: () => {
      host.remove();
      if (activeOverlay === handle) activeOverlay = null;
    }
  };
  shadow.addEventListener("click", (e) => {
    const path = e.composedPath();
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node.getAttribute?.("data-prson-select-close") !== null) {
        handle.close();
        return;
      }
      const page = node.getAttribute?.("data-prson-select-page");
      if (page === "up") {
        if (currentPage > 0) {
          currentPage -= 1;
          renderPage();
        }
        return;
      }
      if (page === "down") {
        if (currentPage < numPages - 1) {
          currentPage += 1;
          renderPage();
        }
        return;
      }
      const optAttr = node.getAttribute?.("data-prson-select-option");
      if (optAttr !== null && optAttr !== void 0) {
        const idx = Number.parseInt(optAttr, 10);
        const chosen = options[idx];
        if (chosen) {
          select.value = chosen.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        handle.close();
        return;
      }
      if (node.getAttribute?.("data-prson-select-backdrop") !== null) {
        handle.close();
        return;
      }
    }
  });
  activeOverlay = handle;
  return handle;
}
function findNearestClickableInOverlay(x, y) {
  if (!activeOverlay) return null;
  const candidates = activeOverlay.shadow.querySelectorAll(
    "[data-prson-select-close],[data-prson-select-page]:not([disabled]),[data-prson-select-option]"
  );
  let best = null;
  let bestDist = Infinity;
  for (const el of Array.from(candidates)) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return best;
}
function setOverlaySnap(target) {
  if (!activeOverlay) return;
  activeOverlay.shadow.querySelectorAll("[data-prson-magic-snap]").forEach((el) => el.removeAttribute("data-prson-magic-snap"));
  if (target) target.setAttribute("data-prson-magic-snap", "");
}
function pickTitle(select) {
  if (select.id) {
    const lbl = document.querySelector(
      `label[for="${cssEscapeLocal(select.id)}"]`
    );
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const wrap = select.closest("label");
  if (wrap && wrap.textContent) {
    const txt = wrap.textContent.replace(select.textContent ?? "", "").trim();
    if (txt) return txt;
  }
  const aria = select.getAttribute("aria-label");
  if (aria) return aria;
  const name = select.getAttribute("name");
  if (name) return name;
  return "Select an option";
}
function pageOfValue(current, options, pageSize) {
  const idx = options.findIndex((o) => o.value === current);
  if (idx < 0) return 0;
  return Math.floor(idx / pageSize);
}
function cssEscapeLocal(s) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
var OVERLAY_CSS = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    color: #0f172a;
  }
  * { box-sizing: border-box; }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .panel {
    width: min(440px, 100%);
    max-height: 88vh;
    background: #ffffff;
    border-radius: 20px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 56px rgba(15, 23, 42, 0.32);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 20px;
    border-bottom: 1px solid #e2e8f0;
  }
  .title {
    flex: 1;
    font-size: 18px;
    font-weight: 700;
    color: #0f172a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 1px solid #e2e8f0;
    background: #f1f5f9;
    color: #475569;
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .close:hover { background: #e2e8f0; }
  .options-wrap {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .page-btn {
    width: 100%;
    padding: 18px 20px;
    border: none;
    background: #f8fafc;
    color: #475569;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .page-btn .chev { font-size: 13px; opacity: 0.8; }
  .page-btn:hover { background: #f1f5f9; color: #1e293b; }
  .page-btn[disabled] {
    opacity: 0.35;
    cursor: default;
    background: #f8fafc;
    color: #475569;
  }
  .options-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .option {
    appearance: none;
    width: 100%;
    padding: 18px 20px;
    border: none;
    background: #ffffff;
    color: #0f172a;
    font-size: 16px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    border-bottom: 1px solid #f1f5f9;
    min-height: 60px;
  }
  .option:hover { background: #eff6ff; color: #1d4ed8; }
  .option[data-selected] {
    background: #dbeafe;
    color: #1d4ed8;
    font-weight: 700;
  }
  /* Snap-preview highlight, shared attribute name with the cursor.
     Lives inside the shadow root so the page's selector (if any)
     can't override it. */
  [data-prson-magic-snap] {
    outline: 3px solid #3b82f6;
    outline-offset: -3px;
    background: #eff6ff;
  }
  .option[data-prson-magic-snap] { color: #1d4ed8; }
`;

// src/point_phone_overlay.ts
var active = null;
function closePointPhoneOverlay() {
  active?.close();
}
function openPointPhoneOverlay() {
  if (active) return active;
  const host = document.createElement("div");
  host.setAttribute("data-prson-point-phone-overlay", "");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "2147483645";
  host.style.pointerEvents = "none";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS2;
  shadow.appendChild(style);
  const glow = document.createElement("div");
  glow.className = "glow";
  shadow.appendChild(glow);
  const pill = document.createElement("div");
  pill.className = "pill";
  pill.innerHTML = `
    <span class="dot"></span>
    <span class="text">Point your phone at the screen to use Magic wand</span>
  `;
  shadow.appendChild(pill);
  let closed = false;
  let timer = null;
  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener("mousemove", onRealMouseMove);
    host.style.transition = "opacity 180ms ease";
    host.style.opacity = "0";
    setTimeout(() => host.remove(), 200);
    if (active && active.host === host) active = null;
  }
  function onRealMouseMove(_e) {
    close();
  }
  window.addEventListener("mousemove", onRealMouseMove);
  timer = setTimeout(close, 15e3);
  const handle = { host, close };
  active = handle;
  return handle;
}
var OVERLAY_CSS2 = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  /* Inner-glow viewport border. Two stacked inset shadows: the
     wide soft halo + a thin defined edge. */
  .glow {
    position: fixed;
    inset: 0;
    pointer-events: none;
    box-shadow:
      inset 0 0 0 2px rgba(59, 130, 246, 0.75),
      inset 0 0 28px 6px rgba(59, 130, 246, 0.35),
      inset 0 0 80px 24px rgba(59, 130, 246, 0.18);
    animation: prson-glow-pulse 2.4s ease-in-out infinite;
  }
  @keyframes prson-glow-pulse {
    0%, 100% { opacity: 0.85; }
    50%      { opacity: 1; }
  }
  .pill {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 18px 28px;
    border-radius: 999px;
    background: #0f172a;
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.1px;
    box-shadow:
      0 18px 40px rgba(15, 23, 42, 0.45),
      0 0 0 1px rgba(255, 255, 255, 0.06) inset;
    /* Pulse-fade in so the pill doesn't pop harshly. */
    animation: prson-pill-fade-in 240ms ease-out both;
  }
  @keyframes prson-pill-fade-in {
    from { opacity: 0; transform: translate(-50%, calc(-50% + 6px)); }
    to   { opacity: 1; transform: translate(-50%, -50%); }
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(59, 130, 246, 1);
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.25);
    animation: prson-dot-pulse 1.4s ease-in-out infinite;
    flex: none;
  }
  @keyframes prson-dot-pulse {
    0%, 100% { transform: scale(1);   opacity: 1;    }
    50%      { transform: scale(1.3); opacity: 0.65; }
  }
  .text {
    line-height: 1.25;
  }
`;

// src/bind.ts
function bindInput(session, element) {
  return {
    async request(opts) {
      const req = inputRequestFromElement(element, opts?.reason);
      const reply = await session.request(req, opts);
      if (reply.ok) writeValueIntoElement(element, reply.value);
      return reply;
    },
    dispose() {
    }
  };
}
function bindForm(session, container) {
  return {
    async request(opts) {
      const elements = collectFieldElements(container);
      if (elements.length === 0) {
        return {
          ok: false,
          error: "unsupported"
        };
      }
      if (elements.length === 1) {
        const reply2 = await session.request(
          inputRequestFromElement(elements[0], opts?.reason),
          opts
        );
        if (reply2.ok) writeValueIntoElement(elements[0], reply2.value);
        if (reply2.ok && container instanceof HTMLFormElement) {
          tryRequestSubmit(container);
        }
        return reply2;
      }
      const fields = elements.map((el, i) => fieldFromElement(el, i));
      const req = {
        kind: "input-form",
        fields,
        submitLabel: container instanceof HTMLFormElement ? "Send" : "Done",
        reason: opts?.reason
      };
      const reply = await session.request(req, opts);
      if (reply.ok && reply.value && typeof reply.value === "object") {
        const values = reply.value;
        for (const el of elements) {
          const name = nameForElement(el, elements.indexOf(el));
          if (name in values) writeValueIntoElement(el, values[name]);
        }
        if (container instanceof HTMLFormElement) tryRequestSubmit(container);
      }
      return reply;
    },
    dispose() {
    }
  };
}
function inputRequestFromElement(el, reason) {
  if (el instanceof HTMLSelectElement) {
    return {
      kind: "input",
      inputType: "select",
      label: resolveLabel(el),
      options: readOptions(el),
      defaultValue: el.value || void 0,
      required: el.required,
      reason
    };
  }
  const inputType = resolveInputType(el);
  const base = {
    kind: "input",
    inputType,
    label: resolveLabel(el),
    placeholder: el.placeholder || void 0,
    defaultValue: el.value || void 0,
    required: el instanceof HTMLInputElement ? el.required : false,
    reason
  };
  return {
    ...base,
    ...textConstraints(el),
    ...el instanceof HTMLInputElement && inputType === "number" ? numericConstraints(el) : {},
    ...el instanceof HTMLInputElement && el.pattern ? { pattern: el.pattern } : {}
  };
}
function fieldFromElement(el, index) {
  const name = nameForElement(el, index);
  if (el instanceof HTMLSelectElement) {
    return {
      name,
      inputType: "select",
      label: resolveLabel(el),
      options: readOptions(el),
      defaultValue: el.value || void 0,
      required: el.required
    };
  }
  const inputType = resolveInputType(el);
  return {
    name,
    inputType,
    label: resolveLabel(el),
    placeholder: el.placeholder || void 0,
    defaultValue: el.value || void 0,
    required: el instanceof HTMLInputElement ? el.required : false,
    ...textConstraints(el),
    ...el instanceof HTMLInputElement && inputType === "number" ? numericConstraints(el) : {},
    ...el instanceof HTMLInputElement && el.pattern ? { pattern: el.pattern } : {}
  };
}
function collectFieldElements(container) {
  const out = [];
  const all = container.querySelectorAll(
    "input, textarea, select"
  );
  const SKIPPED = /* @__PURE__ */ new Set([
    "button",
    "submit",
    "reset",
    "image",
    "hidden",
    "file",
    "checkbox",
    "radio"
  ]);
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "text").toLowerCase();
      if (SKIPPED.has(t)) continue;
      if (el.disabled || el.readOnly) continue;
      out.push(el);
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.disabled || el.readOnly) continue;
      out.push(el);
    } else if (el instanceof HTMLSelectElement) {
      if (el.disabled) continue;
      out.push(el);
    }
  }
  return out;
}
function resolveInputType(el) {
  if (el instanceof HTMLTextAreaElement) return "text";
  const t = (el.type || "text").toLowerCase();
  switch (t) {
    case "text":
    case "search":
    case "email":
    case "tel":
    case "url":
    case "number":
    case "password":
      return t;
    // HTML5 types we don't have a wallet-side keyboard for — fall
    // back to `text` so the drawer still renders something useful.
    case "date":
    case "datetime-local":
    case "time":
    case "month":
    case "week":
    case "color":
    case "range":
    default:
      return "text";
  }
}
function resolveLabel(el) {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  if (el.id) {
    const lbl = el.ownerDocument.querySelector(
      `label[for="${cssEscape(el.id)}"]`
    );
    if (lbl && lbl.textContent && lbl.textContent.trim()) {
      return lbl.textContent.trim();
    }
  }
  const closestLabel = el.closest("label");
  if (closestLabel && closestLabel.textContent) {
    const ownText = "value" in el && typeof el.value === "string" ? el.value : el.textContent ?? "";
    const raw = closestLabel.textContent.replace(ownText, "").trim();
    if (raw) return raw;
  }
  if ("placeholder" in el && el.placeholder && el.placeholder.trim()) {
    return el.placeholder.trim();
  }
  if (el.name) return prettyName(el.name);
  return prettyName(el.tagName.toLowerCase());
}
function readOptions(el) {
  const out = [];
  for (let i = 0; i < el.options.length; i++) {
    const opt = el.options[i];
    out.push({
      value: opt.value,
      label: opt.label || opt.textContent || opt.value
    });
  }
  return out;
}
function textConstraints(el) {
  const out = {};
  if ("minLength" in el && el.minLength > 0) out.minLength = el.minLength;
  if ("maxLength" in el && el.maxLength > 0) out.maxLength = el.maxLength;
  return out;
}
function numericConstraints(el) {
  const out = {};
  const minStr = el.getAttribute("min");
  const maxStr = el.getAttribute("max");
  if (minStr !== null && minStr !== "") {
    const n = Number(minStr);
    if (Number.isFinite(n)) out.min = n;
  }
  if (maxStr !== null && maxStr !== "") {
    const n = Number(maxStr);
    if (Number.isFinite(n)) out.max = n;
  }
  return out;
}
function nameForElement(el, index) {
  if (el.name) return el.name;
  if (el.id) return el.id;
  return `_field_${index}`;
}
function prettyName(s) {
  return s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
function b64uToBytes(s) {
  const pad = (4 - s.length % 4) % 4;
  const std = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bin = atob(std);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
function bytesToHex(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
function writeValueIntoElement(el, value) {
  if (value === void 0 || value === null) return;
  const str = String(value);
  if (el instanceof HTMLSelectElement) {
    let matched = false;
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].value === str) {
        el.selectedIndex = i;
        matched = true;
        break;
      }
    }
    if (!matched) {
      for (let i = 0; i < el.options.length; i++) {
        if (el.options[i].label === str) {
          el.selectedIndex = i;
          break;
        }
      }
    }
  } else {
    el.value = str;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function tryRequestSubmit(form) {
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
  } else {
    form.submit();
  }
}
function enableRemoteNavigation(session, opts) {
  const root = opts?.root ?? document.body;
  let currentFocused = null;
  let disposed = false;
  function isBindable(el) {
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "text").toLowerCase();
      if (t === "hidden" || t === "submit" || t === "button" || t === "reset" || t === "image" || t === "checkbox" || t === "radio") return false;
      if (t === "file") return !el.disabled;
      return !el.disabled && !el.readOnly;
    }
    if (el instanceof HTMLTextAreaElement) {
      return !el.disabled && !el.readOnly;
    }
    if (el instanceof HTMLSelectElement) {
      return !el.disabled;
    }
    return false;
  }
  function isFocusableButton(el) {
    if (el instanceof HTMLButtonElement) return !el.disabled;
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "text").toLowerCase();
      return (t === "submit" || t === "button" || t === "reset") && !el.disabled;
    }
    return el.getAttribute("role") === "button";
  }
  function collectFields() {
    if (opts?.collectFields) return opts.collectFields();
    const out = [];
    const all = root.querySelectorAll("input, textarea, select");
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (isBindable(el)) out.push(el);
    }
    return out;
  }
  function computeNavMeta(el) {
    const isButton = el instanceof HTMLButtonElement || el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button" || el.type === "reset") || el.getAttribute("role") === "button";
    if (isButton) {
      return { hasPrev: false, hasNext: false, isLastInForm: false, isButton: true };
    }
    const fields = collectFields();
    const idx = fields.indexOf(el);
    const hasPrev = idx > 0;
    const hasNext = idx >= 0 && idx < fields.length - 1;
    let isLastInForm = false;
    const form = el.closest?.("form");
    if (form instanceof HTMLFormElement) {
      const fieldsInForm = fields.filter((f) => f.closest("form") === form);
      isLastInForm = fieldsInForm.length > 0 && fieldsInForm[fieldsInForm.length - 1] === el;
    }
    return { hasPrev, hasNext, isLastInForm, isButton: false };
  }
  function focusPayloadFor(el) {
    const name = nameForElement(el, 0);
    const meta = computeNavMeta(el);
    if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button" || el.type === "reset")) {
      return {
        name,
        label: resolveLabel(el),
        inputType: "button",
        value: el instanceof HTMLButtonElement ? (el.textContent ?? "").trim() : el.value,
        ...meta
      };
    }
    if (el instanceof HTMLSelectElement) {
      return {
        name,
        label: resolveLabel(el),
        inputType: "select",
        value: el.value,
        options: readOptions(el),
        required: el.required,
        ...meta
      };
    }
    if (el instanceof HTMLInputElement && el.type === "file") {
      return {
        name,
        label: resolveLabel(el),
        inputType: "file",
        value: "",
        required: el.required,
        accept: el.accept || void 0,
        multiple: el.multiple || void 0,
        capture: el.getAttribute("capture") || void 0,
        ...meta
      };
    }
    const inputType = resolveInputType(el);
    return {
      name,
      label: resolveLabel(el),
      inputType,
      value: el.value,
      placeholder: "placeholder" in el ? el.placeholder || void 0 : void 0,
      required: el instanceof HTMLInputElement ? el.required : false,
      ...textConstraints(el),
      ...el instanceof HTMLInputElement && inputType === "number" ? numericConstraints(el) : {},
      ...el instanceof HTMLInputElement && el.pattern ? { pattern: el.pattern } : {},
      ...meta
    };
  }
  let pendingFrame = null;
  function scheduleValuePush() {
    if (pendingFrame !== null) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      if (disposed || !currentFocused) return;
      void session._sendFocus(focusPayloadFor(currentFocused));
    });
  }
  function onFocusIn(ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (isBindable(t)) {
      currentFocused = t;
      void session._sendFocus(focusPayloadFor(t));
      return;
    }
    if (isFocusableButton(t)) {
      currentFocused = t;
      void session._sendFocus(focusPayloadFor(t));
    }
  }
  function onFocusOut(ev) {
    const t = ev.target;
    if (t !== currentFocused) return;
    currentFocused = null;
    void session._sendFocus(null);
  }
  function onInputChange(ev) {
    if (ev.target !== currentFocused) return;
    scheduleValuePush();
  }
  function applyNav(action) {
    if (action === "submit") {
      const focused = currentFocused;
      if (focused instanceof HTMLButtonElement || focused instanceof HTMLInputElement && (focused.type === "submit" || focused.type === "button" || focused.type === "reset") || focused?.getAttribute("role") === "button") {
        try {
          focused.click();
        } catch {
        }
        return;
      }
      const form = currentFocused?.closest("form") ?? root.querySelector("form");
      if (form instanceof HTMLFormElement) tryRequestSubmit(form);
      return;
    }
    const fields = collectFields();
    if (fields.length === 0) return;
    let idx = currentFocused ? fields.indexOf(currentFocused) : -1;
    if (idx === -1) idx = action === "prev" ? fields.length : -1;
    const target = action === "next" ? fields[(idx + 1) % fields.length] : fields[(idx - 1 + fields.length) % fields.length];
    target.focus();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const len = target.value.length;
      try {
        target.setSelectionRange(len, len);
      } catch {
      }
    }
  }
  function applyValue(value) {
    if (!currentFocused) return;
    if (currentFocused instanceof HTMLInputElement || currentFocused instanceof HTMLTextAreaElement || currentFocused instanceof HTMLSelectElement) {
      writeValueIntoElement(currentFocused, value);
    }
  }
  const unsubscribe = session._setRemoteNavListener((envelope) => {
    if (envelope.msg === "nav") applyNav(envelope.action);
    else if (envelope.msg === "value") applyValue(envelope.value);
    else if (envelope.msg === "logout") dispose();
  });
  const transfers = /* @__PURE__ */ new Map();
  const offFile = session._setFileEnvelopeHandler((envelope) => {
    const reqId = envelope.requestId;
    if (!reqId) return;
    if (envelope.msg === "file-begin") {
      const begin = envelope.fileBegin;
      if (!begin) return;
      const target = currentFocused instanceof HTMLInputElement && currentFocused.type === "file" ? currentFocused : null;
      transfers.set(reqId, {
        name: begin.name,
        mimeType: begin.mimeType,
        size: begin.size,
        totalChunks: begin.totalChunks,
        received: 0,
        parts: new Array(begin.totalChunks),
        targetInput: target
      });
      return;
    }
    if (envelope.msg === "file-chunk") {
      const xfer = transfers.get(reqId);
      const chunk = envelope.fileChunk;
      if (!xfer || !chunk) return;
      const bytes = b64uToBytes(chunk.data);
      if (!bytes) return;
      xfer.parts[chunk.index] = bytes;
      xfer.received += 1;
      return;
    }
    if (envelope.msg === "file-end") {
      const xfer = transfers.get(reqId);
      const end = envelope.fileEnd;
      if (!xfer || !end) return;
      transfers.delete(reqId);
      void assembleAndCommit(xfer, end.sha256);
      return;
    }
  });
  async function assembleAndCommit(xfer, expectedSha256Hex) {
    if (xfer.received !== xfer.totalChunks) return;
    const blob = new Blob(xfer.parts, { type: xfer.mimeType });
    const buf = await blob.arrayBuffer();
    const digestBuf = await crypto.subtle.digest("SHA-256", buf);
    const actual = bytesToHex(new Uint8Array(digestBuf));
    if (actual !== expectedSha256Hex.toLowerCase()) {
      return;
    }
    const target = xfer.targetInput;
    if (!target || disposed) return;
    const file = new File([blob], xfer.name, {
      type: xfer.mimeType,
      lastModified: Date.now()
    });
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      target.files = dt.files;
    } catch {
      return;
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const offSignedOut = session.on("signed_out", () => dispose());
  root.addEventListener("focusin", onFocusIn, true);
  root.addEventListener("focusout", onFocusOut, true);
  root.addEventListener("input", onInputChange, true);
  root.addEventListener("change", onInputChange, true);
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
    root.removeEventListener("focusin", onFocusIn, true);
    root.removeEventListener("focusout", onFocusOut, true);
    root.removeEventListener("input", onInputChange, true);
    root.removeEventListener("change", onInputChange, true);
    unsubscribe();
    offFile();
    offSignedOut();
    transfers.clear();
  }
  return { dispose };
}
function bindMouse(session, opts) {
  const mode = opts?.mode ?? "touch";
  const size = Math.max(6, opts?.size ?? 28);
  const color = opts?.color ?? "rgba(59, 130, 246, 0.65)";
  const onMove = opts?.onMove;
  const onClick = opts?.onClick;
  let cursor = null;
  let pos = opts?.initialPosition ?? {
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0
  };
  let disposed = false;
  let snapTarget = null;
  let activeMode = mode;
  function onWindowBlur() {
    if (disposed) return;
    void session._sendControlStatus(true);
  }
  function onWindowFocus() {
    if (disposed) return;
    void session._sendControlStatus(false);
    closePointPhoneOverlay();
  }
  if (typeof window !== "undefined") {
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    if (typeof document !== "undefined" && document.hasFocus && !document.hasFocus()) {
      void session._sendControlStatus(true);
    }
  }
  const offAmbient = session._setAmbientMouseHandler((mouseBody) => {
    if (disposed) return;
    if (mouseBody.event === "begin" || mouseBody.event === "end") {
      ensureCursor();
      return;
    }
    applyFrame(mouseBody);
  });
  function ensureCursor() {
    if (cursor) return cursor;
    const existing = document.querySelector(
      "[data-prson-virtual-cursor]"
    );
    if (existing) {
      cursor = existing;
      existing.style.width = `${size}px`;
      existing.style.height = `${size}px`;
      existing.style.background = color;
      existing.style.display = "block";
      applyCursorPosition(existing, pos);
      return existing;
    }
    const el = document.createElement("div");
    el.setAttribute("data-prson-virtual-cursor", "");
    el.style.position = "fixed";
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = "50%";
    el.style.background = color;
    el.style.border = "2px solid rgba(255, 255, 255, 0.9)";
    el.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.25)";
    el.style.pointerEvents = "none";
    el.style.zIndex = "2147483647";
    el.style.transform = "translate(-50%, -50%)";
    el.style.transition = "background 120ms ease, opacity 120ms ease";
    applyCursorPosition(el, pos);
    document.body.appendChild(el);
    cursor = el;
    return el;
  }
  function applyCursorPosition(el, p) {
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  }
  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }
  function setSnapTarget(next) {
    if (next === snapTarget) return;
    if (snapTarget) {
      snapTarget.removeAttribute("data-prson-magic-snap");
      snapTarget.classList.remove("prson-magic-snap");
    }
    snapTarget = next;
    if (snapTarget) {
      snapTarget.setAttribute("data-prson-magic-snap", "");
      snapTarget.classList.add("prson-magic-snap");
    }
  }
  function applyFrame(mouse) {
    if (disposed) return;
    const el = ensureCursor();
    if (mouse.mode === "touch" || mouse.mode === "magic") {
      if (mouse.mode !== activeMode) {
        activeMode = mouse.mode;
        if (activeMode === "touch") setSnapTarget(null);
      }
    }
    switch (mouse.event) {
      case "move": {
        pos = {
          x: clamp(pos.x + (mouse.dx ?? 0), 0, window.innerWidth),
          y: clamp(pos.y + (mouse.dy ?? 0), 0, window.innerHeight)
        };
        applyCursorPosition(el, pos);
        if (onMove) {
          try {
            onMove(pos);
          } catch {
          }
        }
        if (activeMode === "magic") {
          if (isSelectOverlayActive()) {
            setSnapTarget(null);
            setOverlaySnap(findNearestClickableInOverlay(pos.x, pos.y));
          } else {
            setOverlaySnap(null);
            setSnapTarget(findNearestClickable(pos.x, pos.y));
          }
        }
        break;
      }
      case "click":
      case "double-click": {
        const prev = el.style.background;
        el.style.background = "rgba(59, 130, 246, 1)";
        setTimeout(() => {
          if (cursor === el) el.style.background = prev;
        }, 140);
        if (isSelectOverlayActive()) {
          const overlayTarget = (snapTarget && snapTarget.closest?.(
            "[data-prson-select-close],[data-prson-select-page],[data-prson-select-option]"
          )) ?? findNearestClickableInOverlay(pos.x, pos.y);
          if (overlayTarget) {
            const init = {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: pos.x,
              clientY: pos.y,
              view: window
            };
            overlayTarget.dispatchEvent(new MouseEvent("mousedown", init));
            overlayTarget.dispatchEvent(new MouseEvent("mouseup", init));
            overlayTarget.dispatchEvent(new MouseEvent("click", init));
          }
          break;
        }
        const snapped = activeMode === "magic" ? snapTarget : findNearestClickable(pos.x, pos.y);
        if (snapped instanceof HTMLSelectElement) {
          openSelectOverlay(snapped);
          setSnapTarget(null);
          break;
        }
        const direct = document.elementFromPoint(pos.x, pos.y);
        const target = snapped ?? direct;
        const clickPoint = snapped ? rectCenter(snapped.getBoundingClientRect()) : { x: pos.x, y: pos.y };
        let allowDefault = true;
        if (onClick) {
          try {
            const ret = onClick(target);
            if (ret === false) allowDefault = false;
          } catch {
          }
        }
        if (allowDefault && target) {
          const init = {
            bubbles: true,
            cancelable: true,
            clientX: clickPoint.x,
            clientY: clickPoint.y,
            view: window
          };
          target.dispatchEvent(new MouseEvent("mousedown", init));
          target.dispatchEvent(new MouseEvent("mouseup", init));
          target.dispatchEvent(new MouseEvent("click", init));
          if (mouse.event === "double-click") {
            target.dispatchEvent(new MouseEvent("dblclick", init));
          }
          if (snapped && typeof target.focus === "function") {
            try {
              target.focus({ preventScroll: true });
            } catch {
            }
          }
        }
        break;
      }
      case "scroll": {
        window.scrollBy({ left: mouse.dx ?? 0, top: mouse.dy ?? 0 });
        break;
      }
      case "hide": {
        if (cursor) {
          cursor.style.opacity = "0";
          cursor.style.pointerEvents = "none";
        }
        setSnapTarget(null);
        setOverlaySnap(null);
        openPointPhoneOverlay();
        break;
      }
      case "show": {
        const el2 = ensureCursor();
        el2.style.opacity = "1";
        if (typeof window !== "undefined") {
          pos = {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2
          };
          applyCursorPosition(el2, pos);
        }
        closePointPhoneOverlay();
        break;
      }
      case "begin":
      case "end": {
        break;
      }
    }
  }
  function detach() {
    if (cursor) {
      cursor.remove();
      cursor = null;
    }
    setSnapTarget(null);
    setOverlaySnap(null);
    closeAllOverlays();
    closePointPhoneOverlay();
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    }
    offAmbient();
  }
  return {
    async request(callerOpts) {
      if (disposed) return { ok: false, error: "session-closed" };
      ensureCursor();
      const MAX_SAFE_TIMEOUT = 2147483e3;
      const credentialBudget = session.expiresAt - Date.now() + 1e3;
      const sessionEndMs = Math.max(
        6e4,
        Math.min(credentialBudget, MAX_SAFE_TIMEOUT)
      );
      const reply = await session.requestMouse(
        { kind: "mouse", mode, reason: callerOpts?.reason ?? opts?.reason },
        applyFrame,
        { timeoutMs: sessionEndMs, ...callerOpts }
      );
      if (!disposed) {
        if (cursor) {
          cursor.remove();
          cursor = null;
        }
      }
      return reply;
    },
    dispose() {
      disposed = true;
      detach();
    }
  };
}
var SNAP_SELECTOR = 'input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled]),a[href],[role="button"],[role="link"],[role="checkbox"],[role="radio"],label[for],[tabindex]:not([tabindex="-1"])';
var SNAP_RADIUS_PX = 60;
function rectCenter(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function findNearestClickable(x, y) {
  if (typeof document === "undefined") return null;
  const candidates = document.querySelectorAll(SNAP_SELECTOR);
  let best = null;
  let bestDist = Infinity;
  for (const el of Array.from(candidates)) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return bestDist <= SNAP_RADIUS_PX ? best : null;
}
function cssEscape(s) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/(["\\#.>+~*$^|=:()\[\] ])/g, "\\$1");
}

// src/index.ts
var PROTOCOL_VERSION = "prson_vp_v1";
var TRUSTED_ISSUER = "did:web:app.prson.net";
var KNOWN_VCTS = [
  "https://app.prson.net/credentials/verified-human/v1",
  "https://app.prson.net/credentials/verified-identity/v1"
];
var ANONYMOUS_WALLET_VCT2 = "https://app.prson.net/credentials/anonymous-wallet/v1";
var DEFAULT_TTL_MINUTES = 2;
var MAX_TTL_MINUTES = 2;
var SIGNALING_BASE = "https://signaling.prson.net";
var SIGNALING_BASE_DEV = "https://signaling-dev.prson.net";
function resolveSignalingBase(opts) {
  if (opts.signalingBase) return opts.signalingBase;
  return opts.environment === "dev" ? SIGNALING_BASE_DEV : SIGNALING_BASE;
}
var LoginAbortedError = class extends Error {
  constructor(message = "sign-in aborted by a newer signIn() call") {
    super(message);
    this.name = "LoginAbortedError";
  }
};
var _inflight = null;
function makeInflight() {
  const teardowns = [];
  const self2 = {
    aborted: false,
    pushTeardown(t) {
      teardowns.push(t);
    },
    async abort() {
      if (self2.aborted) return;
      self2.aborted = true;
      while (teardowns.length) {
        const t = teardowns.pop();
        try {
          await t?.();
        } catch {
        }
      }
    }
  };
  return self2;
}
var PrsonLogin = class {
  /**
   * Drive a full sign-in. The promise resolves once the wallet has
   * delivered a verified SD-JWT-VC; the returned session lives until
   * one of the four `ExpiryReason` triggers.
   */
  static async signIn(opts = {}) {
    const prior = _inflight;
    if (prior) await prior.abort();
    const me = makeInflight();
    _inflight = me;
    const checkAborted = () => {
      if (me.aborted) throw new LoginAbortedError();
    };
    try {
      const domain = opts.domain ?? window.location.origin.replace(/^https?:\/\//, "");
      const ttlMaxMinutes = Math.min(
        Math.max(opts.ttlMinutes ?? DEFAULT_TTL_MINUTES, 1),
        MAX_TTL_MINUTES
      );
      const ephKeys = await generateEphemeralKeypair();
      checkAborted();
      if (opts.nonce !== void 0 && !/^[A-Za-z0-9_-]{22,128}$/.test(opts.nonce)) {
        throw new Error("nonce must be 22-128 base64url characters (at least 16 random bytes)");
      }
      const nonce = opts.nonce ?? b64u(crypto.getRandomValues(new Uint8Array(32)));
      const request = {
        domain,
        nonce,
        browserPk: ephKeys.publicKeyB64u,
        required: opts.required ?? {},
        // Carried into the wallet's drawer so an "Anonymous" option is
        // offered. The SDK side enforces acceptance below at verify time;
        // the wallet enforces drawer UX based on this flag.
        allowAnonymous: opts.allowAnonymous === true,
        // Sponsorship offer (advisory on the wire — the server enforces
        // the stored grant's domain/caps/budget at charge time).
        ...opts.sponsorship?.grantId ? { sponsorship: { grantId: opts.sponsorship.grantId } } : {},
        // If set, instructs the wallet to mint a fresh random Ed25519
        // keypair for this single sign-in (no deterministic per-domain
        // HKDF). Closes M-5; see SignInOptions.ephemeralIdentity.
        ephemeralIdentity: opts.ephemeralIdentity === true,
        // QR-mode remote navigation — wallet surfaces Prev / Next /
        // Submit / Logout / Mouse on a persistent banner. See
        // SignInOptions.remoteNavigation + bind.ts:enableRemoteNavigation.
        remoteNavigation: opts.remoteNavigation === true,
        // Pre-grant mouse control — wallet enables the Touchpad /
        // Magic wand buttons on the banner drawer from session start.
        // See SignInOptions.mouseControl + bindMouse's ambient
        // subscriber path.
        mouseControl: opts.mouseControl === true,
        // App-to-app return leg — validated here (fail fast at the
        // integrator's desk) AND in the wallet (the enforcing side).
        ...opts.returnUrl ? { returnUrl: validateReturnUrl(opts.returnUrl, domain) } : {},
        ttlMaxMinutes
      };
      const draft = await createDraft(request, {
        signalingBase: resolveSignalingBase(opts)
      });
      checkAborted();
      const qrUrl = buildDeepLinkUrl({
        reqId: draft.reqId,
        browserPk: ephKeys.publicKeyB64u,
        nonce,
        domain,
        request,
        serverTs: draft.serverTs
      });
      const explicitMount = resolveMount(opts.ui?.mountQrInto);
      let qrHandle = null;
      let modalHandle = null;
      if (explicitMount) {
        qrHandle = renderLoginQr(qrUrl, explicitMount, opts.ui?.theme ?? "auto");
      } else {
        modalHandle = createModalQrMount({
          onDismiss: () => {
            void me.abort();
          }
        });
        qrHandle = renderLoginQr(
          qrUrl,
          modalHandle.mount,
          opts.ui?.theme ?? "auto"
        );
      }
      if (qrHandle) me.pushTeardown(() => qrHandle.dispose());
      if (modalHandle) me.pushTeardown(() => modalHandle.dispose());
      const signaling = await connectSignaling({
        url: draft.signalingWss,
        role: "browser",
        sigToken: draft.draftToken
      });
      me.pushTeardown(() => signaling.close());
      checkAborted();
      const transport = await establishTransport({
        stunOnly: true,
        signaling,
        role: "browser",
        // When the Worker minted TURN creds at draft time, hand them
        // to the peer connection so the browser also has a relay
        // candidate. Older Workers may omit `turn` from the draft
        // response; falling back to STUN-only matches the prior
        // behaviour.
        turn: draft.turn
      });
      me.pushTeardown(() => transport.close());
      checkAborted();
      const first = await transport.awaitFirstMessage();
      checkAborted();
      const envelope = await decryptEnvelope(first, ephKeys);
      if (envelope.v !== PROTOCOL_VERSION || envelope.msg !== "presentation") {
        throw new Error(`Unexpected first message: ${envelope.v}/${envelope.msg}`);
      }
      const presentationStr = envelope.presentation;
      if (!presentationStr) {
        throw new Error("Initial presentation envelope had no presentation field");
      }
      const acceptedVcts = opts.allowAnonymous ? [...KNOWN_VCTS, ANONYMOUS_WALLET_VCT2] : [...KNOWN_VCTS];
      const verified = await verifyPresentation(presentationStr, {
        expectedAudience: `https://${domain}`,
        expectedNonce: nonce,
        acceptedVcts,
        trustedIssuer: TRUSTED_ISSUER
      });
      if (!verified.ok) {
        throw new Error(`Presentation rejected: ${verified.reason}`);
      }
      if (verified.credential.vct !== ANONYMOUS_WALLET_VCT2) {
        const minLevel = opts.required?.minVerificationLevel ?? 1;
        const claimedLevel = typeof verified.claims.verification_level === "number" ? verified.claims.verification_level : 0;
        if (claimedLevel < minLevel) {
          throw new Error(
            `Presentation rejected: verification_level ${claimedLevel} below required ${minLevel}`
          );
        }
      }
      qrHandle?.dispose();
      modalHandle?.dispose();
      const uniqueHumanId = envelope.uniqueHumanId ?? null;
      if (opts.required?.uniqueHumanId === true && !uniqueHumanId) {
        throw new Error("Presentation rejected: required uniqueHumanId credential missing");
      }
      const result = {
        sdJwtVc: presentationStr,
        nonce,
        claims: verified.claims,
        cnf: verified.cnf,
        credential: verified.credential,
        uniqueHumanId,
        // session is filled in below — temporary placeholder cast
        // avoids a circular-self-reference in the literal.
        session: void 0
      };
      const session = new PrsonLoginSession({
        cnf: verified.cnf,
        credential: verified.credential,
        transport,
        ephKeys,
        verifierContext: {
          expectedAudience: `https://${domain}`,
          expectedNonceFactory: () => nonce,
          // renewals carry a fresh nonce; see session.ts
          acceptedVcts: [...KNOWN_VCTS],
          trustedIssuer: TRUSTED_ISSUER
        },
        // Cache the verified claims so the session can diff them
        // against future `claim-update` envelopes — see ROADMAP §1.
        initialClaims: verified.claims,
        // Fire `signed_in` on the typed event stream. Microtask-
        // deferred inside the constructor, so listeners attached
        // synchronously after this `signIn()` resolves still
        // receive it.
        initialSignedInResult: result,
        // Forward `walletSessionPk` + `preferredLanguage` from the
        // FIRST envelope (which `signIn()` consumed before the session
        // existed) so they're available immediately on the session
        // handle. Without this seed the session would have
        // `walletSessionPk: null` (breaking the request channel) and
        // `preferredLanguage: null` (host can't localise on first
        // paint) until a subsequent envelope arrives.
        walletSessionPk: envelope.walletSessionPk,
        initialPreferredLanguage: envelope.preferredLanguage,
        // Public-profile fields the wallet may stamp onto the first
        // envelope. They aren't part of the verified-human VC (which
        // carries verification facts only), so without seeding here
        // the host's `session.displayName` would stay null until a
        // later `display-update` envelope.
        initialDisplayName: envelope.displayName,
        initialAvatar: envelope.avatar
      });
      result.session = session;
      return result;
    } finally {
      if (_inflight === me) _inflight = null;
    }
  }
  /**
   * Rebind to a session that was previously established for the same
   * holder pk. Phase 2 placeholder — the SDK has no cross-page-load
   * state today; callers should redirect through `signIn` on each
   * page load (the cookie-on-the-server is the source of truth).
   */
  static async restore(_opts) {
    return null;
  }
};
function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function validateReturnUrl(returnUrl, domain) {
  let parsed;
  try {
    parsed = new URL(returnUrl);
  } catch {
    throw new Error(`returnUrl is not a valid URL: ${returnUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      "returnUrl must be https:// (custom schemes are refused \u2014 any app could claim them; use a Universal Link / App Link on your domain)"
    );
  }
  if (parsed.host.toLowerCase() !== domain.toLowerCase()) {
    throw new Error(
      `returnUrl host (${parsed.host}) must equal the login domain (${domain})`
    );
  }
  return returnUrl;
}
function resolveMount(into) {
  if (!into) return null;
  if (typeof into === "string") return document.querySelector(into);
  return into;
}
function buildDeepLinkUrl(args) {
  const params = new URLSearchParams({
    s: args.reqId,
    p: args.browserPk,
    n: args.nonce,
    d: args.domain,
    req: b64u(new TextEncoder().encode(JSON.stringify(args.request))),
    // M-3 / v2: the server-issued timestamp the wallet must fold into
    // its claim signature. The Worker uses its own stored copy at
    // verify time; tampering this in the QR breaks the signature.
    t: String(args.serverTs)
  });
  return `https://app.prson.net/login/v1?${params.toString()}`;
}
export {
  ANONYMOUS_WALLET_VCT2 as ANONYMOUS_WALLET_VCT,
  DEFAULT_TTL_MINUTES,
  KNOWN_VCTS,
  LoginAbortedError,
  MAX_TTL_MINUTES,
  PROTOCOL_VERSION,
  PrsonLogin,
  PrsonLoginSession,
  SIGNALING_BASE,
  SIGNALING_BASE_DEV,
  TRUSTED_ISSUER,
  bindForm,
  bindInput,
  bindMouse,
  enableRemoteNavigation,
  resolveSignalingBase
};
//# sourceMappingURL=prson-login.js.map
