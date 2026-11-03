var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
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

// node_modules/qrcode/lib/can-promise.js
var require_can_promise = __commonJS({
  "node_modules/qrcode/lib/can-promise.js"(exports, module) {
    module.exports = function() {
      return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
    };
  }
});

// node_modules/qrcode/lib/core/utils.js
var require_utils = __commonJS({
  "node_modules/qrcode/lib/core/utils.js"(exports) {
    var toSJISFunction;
    var CODEWORDS_COUNT = [
      0,
      // Not used
      26,
      44,
      70,
      100,
      134,
      172,
      196,
      242,
      292,
      346,
      404,
      466,
      532,
      581,
      655,
      733,
      815,
      901,
      991,
      1085,
      1156,
      1258,
      1364,
      1474,
      1588,
      1706,
      1828,
      1921,
      2051,
      2185,
      2323,
      2465,
      2611,
      2761,
      2876,
      3034,
      3196,
      3362,
      3532,
      3706
    ];
    exports.getSymbolSize = function getSymbolSize(version) {
      if (!version) throw new Error('"version" cannot be null or undefined');
      if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
      return version * 4 + 17;
    };
    exports.getSymbolTotalCodewords = function getSymbolTotalCodewords(version) {
      return CODEWORDS_COUNT[version];
    };
    exports.getBCHDigit = function(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    };
    exports.setToSJISFunction = function setToSJISFunction(f) {
      if (typeof f !== "function") {
        throw new Error('"toSJISFunc" is not a valid function.');
      }
      toSJISFunction = f;
    };
    exports.isKanjiModeEnabled = function() {
      return typeof toSJISFunction !== "undefined";
    };
    exports.toSJIS = function toSJIS(kanji) {
      return toSJISFunction(kanji);
    };
  }
});

// node_modules/qrcode/lib/core/error-correction-level.js
var require_error_correction_level = __commonJS({
  "node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
    exports.L = { bit: 1 };
    exports.M = { bit: 0 };
    exports.Q = { bit: 3 };
    exports.H = { bit: 2 };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "l":
        case "low":
          return exports.L;
        case "m":
        case "medium":
          return exports.M;
        case "q":
        case "quartile":
          return exports.Q;
        case "h":
        case "high":
          return exports.H;
        default:
          throw new Error("Unknown EC Level: " + string);
      }
    }
    exports.isValid = function isValid(level) {
      return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
    };
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// node_modules/qrcode/lib/core/bit-buffer.js
var require_bit_buffer = __commonJS({
  "node_modules/qrcode/lib/core/bit-buffer.js"(exports, module) {
    function BitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    BitBuffer.prototype = {
      get: function(index) {
        const bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
      },
      put: function(num, length) {
        for (let i = 0; i < length; i++) {
          this.putBit((num >>> length - i - 1 & 1) === 1);
        }
      },
      getLengthInBits: function() {
        return this.length;
      },
      putBit: function(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }
    };
    module.exports = BitBuffer;
  }
});

// node_modules/qrcode/lib/core/bit-matrix.js
var require_bit_matrix = __commonJS({
  "node_modules/qrcode/lib/core/bit-matrix.js"(exports, module) {
    function BitMatrix(size) {
      if (!size || size < 1) {
        throw new Error("BitMatrix size must be defined and greater than 0");
      }
      this.size = size;
      this.data = new Uint8Array(size * size);
      this.reservedBit = new Uint8Array(size * size);
    }
    BitMatrix.prototype.set = function(row, col, value, reserved) {
      const index = row * this.size + col;
      this.data[index] = value;
      if (reserved) this.reservedBit[index] = true;
    };
    BitMatrix.prototype.get = function(row, col) {
      return this.data[row * this.size + col];
    };
    BitMatrix.prototype.xor = function(row, col, value) {
      this.data[row * this.size + col] ^= value;
    };
    BitMatrix.prototype.isReserved = function(row, col) {
      return this.reservedBit[row * this.size + col];
    };
    module.exports = BitMatrix;
  }
});

// node_modules/qrcode/lib/core/alignment-pattern.js
var require_alignment_pattern = __commonJS({
  "node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    exports.getRowColCoords = function getRowColCoords(version) {
      if (version === 1) return [];
      const posCount = Math.floor(version / 7) + 2;
      const size = getSymbolSize(version);
      const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
      const positions = [size - 7];
      for (let i = 1; i < posCount - 1; i++) {
        positions[i] = positions[i - 1] - intervals;
      }
      positions.push(6);
      return positions.reverse();
    };
    exports.getPositions = function getPositions(version) {
      const coords = [];
      const pos = exports.getRowColCoords(version);
      const posLength = pos.length;
      for (let i = 0; i < posLength; i++) {
        for (let j = 0; j < posLength; j++) {
          if (i === 0 && j === 0 || // top-left
          i === 0 && j === posLength - 1 || // bottom-left
          i === posLength - 1 && j === 0) {
            continue;
          }
          coords.push([pos[i], pos[j]]);
        }
      }
      return coords;
    };
  }
});

// node_modules/qrcode/lib/core/finder-pattern.js
var require_finder_pattern = __commonJS({
  "node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    var FINDER_PATTERN_SIZE = 7;
    exports.getPositions = function getPositions(version) {
      const size = getSymbolSize(version);
      return [
        // top-left
        [0, 0],
        // top-right
        [size - FINDER_PATTERN_SIZE, 0],
        // bottom-left
        [0, size - FINDER_PATTERN_SIZE]
      ];
    };
  }
});

// node_modules/qrcode/lib/core/mask-pattern.js
var require_mask_pattern = __commonJS({
  "node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
    exports.Patterns = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var PenaltyScores = {
      N1: 3,
      N2: 3,
      N3: 40,
      N4: 10
    };
    exports.isValid = function isValid(mask) {
      return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
    };
    exports.from = function from(value) {
      return exports.isValid(value) ? parseInt(value, 10) : void 0;
    };
    exports.getPenaltyN1 = function getPenaltyN1(data) {
      const size = data.size;
      let points = 0;
      let sameCountCol = 0;
      let sameCountRow = 0;
      let lastCol = null;
      let lastRow = null;
      for (let row = 0; row < size; row++) {
        sameCountCol = sameCountRow = 0;
        lastCol = lastRow = null;
        for (let col = 0; col < size; col++) {
          let module2 = data.get(row, col);
          if (module2 === lastCol) {
            sameCountCol++;
          } else {
            if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
            lastCol = module2;
            sameCountCol = 1;
          }
          module2 = data.get(col, row);
          if (module2 === lastRow) {
            sameCountRow++;
          } else {
            if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
            lastRow = module2;
            sameCountRow = 1;
          }
        }
        if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
        if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
      }
      return points;
    };
    exports.getPenaltyN2 = function getPenaltyN2(data) {
      const size = data.size;
      let points = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
          if (last === 4 || last === 0) points++;
        }
      }
      return points * PenaltyScores.N2;
    };
    exports.getPenaltyN3 = function getPenaltyN3(data) {
      const size = data.size;
      let points = 0;
      let bitsCol = 0;
      let bitsRow = 0;
      for (let row = 0; row < size; row++) {
        bitsCol = bitsRow = 0;
        for (let col = 0; col < size; col++) {
          bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
          if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
          bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
          if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
        }
      }
      return points * PenaltyScores.N3;
    };
    exports.getPenaltyN4 = function getPenaltyN4(data) {
      let darkCount = 0;
      const modulesCount = data.data.length;
      for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
      const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
      return k * PenaltyScores.N4;
    };
    function getMaskAt(maskPattern, i, j) {
      switch (maskPattern) {
        case exports.Patterns.PATTERN000:
          return (i + j) % 2 === 0;
        case exports.Patterns.PATTERN001:
          return i % 2 === 0;
        case exports.Patterns.PATTERN010:
          return j % 3 === 0;
        case exports.Patterns.PATTERN011:
          return (i + j) % 3 === 0;
        case exports.Patterns.PATTERN100:
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case exports.Patterns.PATTERN101:
          return i * j % 2 + i * j % 3 === 0;
        case exports.Patterns.PATTERN110:
          return (i * j % 2 + i * j % 3) % 2 === 0;
        case exports.Patterns.PATTERN111:
          return (i * j % 3 + (i + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    }
    exports.applyMask = function applyMask(pattern, data) {
      const size = data.size;
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          if (data.isReserved(row, col)) continue;
          data.xor(row, col, getMaskAt(pattern, row, col));
        }
      }
    };
    exports.getBestMask = function getBestMask(data, setupFormatFunc) {
      const numPatterns = Object.keys(exports.Patterns).length;
      let bestPattern = 0;
      let lowerPenalty = Infinity;
      for (let p = 0; p < numPatterns; p++) {
        setupFormatFunc(p);
        exports.applyMask(p, data);
        const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
        exports.applyMask(p, data);
        if (penalty < lowerPenalty) {
          lowerPenalty = penalty;
          bestPattern = p;
        }
      }
      return bestPattern;
    };
  }
});

// node_modules/qrcode/lib/core/error-correction-code.js
var require_error_correction_code = __commonJS({
  "node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
    var ECLevel = require_error_correction_level();
    var EC_BLOCKS_TABLE = [
      // L  M  Q  H
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      2,
      1,
      2,
      2,
      4,
      1,
      2,
      4,
      4,
      2,
      4,
      4,
      4,
      2,
      4,
      6,
      5,
      2,
      4,
      6,
      6,
      2,
      5,
      8,
      8,
      4,
      5,
      8,
      8,
      4,
      5,
      8,
      11,
      4,
      8,
      10,
      11,
      4,
      9,
      12,
      16,
      4,
      9,
      16,
      16,
      6,
      10,
      12,
      18,
      6,
      10,
      17,
      16,
      6,
      11,
      16,
      19,
      6,
      13,
      18,
      21,
      7,
      14,
      21,
      25,
      8,
      16,
      20,
      25,
      8,
      17,
      23,
      25,
      9,
      17,
      23,
      34,
      9,
      18,
      25,
      30,
      10,
      20,
      27,
      32,
      12,
      21,
      29,
      35,
      12,
      23,
      34,
      37,
      12,
      25,
      34,
      40,
      13,
      26,
      35,
      42,
      14,
      28,
      38,
      45,
      15,
      29,
      40,
      48,
      16,
      31,
      43,
      51,
      17,
      33,
      45,
      54,
      18,
      35,
      48,
      57,
      19,
      37,
      51,
      60,
      19,
      38,
      53,
      63,
      20,
      40,
      56,
      66,
      21,
      43,
      59,
      70,
      22,
      45,
      62,
      74,
      24,
      47,
      65,
      77,
      25,
      49,
      68,
      81
    ];
    var EC_CODEWORDS_TABLE = [
      // L  M  Q  H
      7,
      10,
      13,
      17,
      10,
      16,
      22,
      28,
      15,
      26,
      36,
      44,
      20,
      36,
      52,
      64,
      26,
      48,
      72,
      88,
      36,
      64,
      96,
      112,
      40,
      72,
      108,
      130,
      48,
      88,
      132,
      156,
      60,
      110,
      160,
      192,
      72,
      130,
      192,
      224,
      80,
      150,
      224,
      264,
      96,
      176,
      260,
      308,
      104,
      198,
      288,
      352,
      120,
      216,
      320,
      384,
      132,
      240,
      360,
      432,
      144,
      280,
      408,
      480,
      168,
      308,
      448,
      532,
      180,
      338,
      504,
      588,
      196,
      364,
      546,
      650,
      224,
      416,
      600,
      700,
      224,
      442,
      644,
      750,
      252,
      476,
      690,
      816,
      270,
      504,
      750,
      900,
      300,
      560,
      810,
      960,
      312,
      588,
      870,
      1050,
      336,
      644,
      952,
      1110,
      360,
      700,
      1020,
      1200,
      390,
      728,
      1050,
      1260,
      420,
      784,
      1140,
      1350,
      450,
      812,
      1200,
      1440,
      480,
      868,
      1290,
      1530,
      510,
      924,
      1350,
      1620,
      540,
      980,
      1440,
      1710,
      570,
      1036,
      1530,
      1800,
      570,
      1064,
      1590,
      1890,
      600,
      1120,
      1680,
      1980,
      630,
      1204,
      1770,
      2100,
      660,
      1260,
      1860,
      2220,
      720,
      1316,
      1950,
      2310,
      750,
      1372,
      2040,
      2430
    ];
    exports.getBlocksCount = function getBlocksCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    exports.getTotalCodewordsCount = function getTotalCodewordsCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
  }
});

// node_modules/qrcode/lib/core/galois-field.js
var require_galois_field = __commonJS({
  "node_modules/qrcode/lib/core/galois-field.js"(exports) {
    var EXP_TABLE = new Uint8Array(512);
    var LOG_TABLE = new Uint8Array(256);
    (function initTables() {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        EXP_TABLE[i] = x;
        LOG_TABLE[x] = i;
        x <<= 1;
        if (x & 256) {
          x ^= 285;
        }
      }
      for (let i = 255; i < 512; i++) {
        EXP_TABLE[i] = EXP_TABLE[i - 255];
      }
    })();
    exports.log = function log(n) {
      if (n < 1) throw new Error("log(" + n + ")");
      return LOG_TABLE[n];
    };
    exports.exp = function exp(n) {
      return EXP_TABLE[n];
    };
    exports.mul = function mul(x, y) {
      if (x === 0 || y === 0) return 0;
      return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
    };
  }
});

// node_modules/qrcode/lib/core/polynomial.js
var require_polynomial = __commonJS({
  "node_modules/qrcode/lib/core/polynomial.js"(exports) {
    var GF = require_galois_field();
    exports.mul = function mul(p1, p2) {
      const coeff = new Uint8Array(p1.length + p2.length - 1);
      for (let i = 0; i < p1.length; i++) {
        for (let j = 0; j < p2.length; j++) {
          coeff[i + j] ^= GF.mul(p1[i], p2[j]);
        }
      }
      return coeff;
    };
    exports.mod = function mod(divident, divisor) {
      let result = new Uint8Array(divident);
      while (result.length - divisor.length >= 0) {
        const coeff = result[0];
        for (let i = 0; i < divisor.length; i++) {
          result[i] ^= GF.mul(divisor[i], coeff);
        }
        let offset = 0;
        while (offset < result.length && result[offset] === 0) offset++;
        result = result.slice(offset);
      }
      return result;
    };
    exports.generateECPolynomial = function generateECPolynomial(degree) {
      let poly = new Uint8Array([1]);
      for (let i = 0; i < degree; i++) {
        poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
      }
      return poly;
    };
  }
});

// node_modules/qrcode/lib/core/reed-solomon-encoder.js
var require_reed_solomon_encoder = __commonJS({
  "node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module) {
    var Polynomial = require_polynomial();
    function ReedSolomonEncoder(degree) {
      this.genPoly = void 0;
      this.degree = degree;
      if (this.degree) this.initialize(this.degree);
    }
    ReedSolomonEncoder.prototype.initialize = function initialize(degree) {
      this.degree = degree;
      this.genPoly = Polynomial.generateECPolynomial(this.degree);
    };
    ReedSolomonEncoder.prototype.encode = function encode(data) {
      if (!this.genPoly) {
        throw new Error("Encoder not initialized");
      }
      const paddedData = new Uint8Array(data.length + this.degree);
      paddedData.set(data);
      const remainder = Polynomial.mod(paddedData, this.genPoly);
      const start = this.degree - remainder.length;
      if (start > 0) {
        const buff = new Uint8Array(this.degree);
        buff.set(remainder, start);
        return buff;
      }
      return remainder;
    };
    module.exports = ReedSolomonEncoder;
  }
});

// node_modules/qrcode/lib/core/version-check.js
var require_version_check = __commonJS({
  "node_modules/qrcode/lib/core/version-check.js"(exports) {
    exports.isValid = function isValid(version) {
      return !isNaN(version) && version >= 1 && version <= 40;
    };
  }
});

// node_modules/qrcode/lib/core/regex.js
var require_regex = __commonJS({
  "node_modules/qrcode/lib/core/regex.js"(exports) {
    var numeric = "[0-9]+";
    var alphanumeric = "[A-Z $%*+\\-./:]+";
    var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
    kanji = kanji.replace(/u/g, "\\u");
    var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
    exports.KANJI = new RegExp(kanji, "g");
    exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
    exports.BYTE = new RegExp(byte, "g");
    exports.NUMERIC = new RegExp(numeric, "g");
    exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
    var TEST_KANJI = new RegExp("^" + kanji + "$");
    var TEST_NUMERIC = new RegExp("^" + numeric + "$");
    var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
    exports.testKanji = function testKanji(str) {
      return TEST_KANJI.test(str);
    };
    exports.testNumeric = function testNumeric(str) {
      return TEST_NUMERIC.test(str);
    };
    exports.testAlphanumeric = function testAlphanumeric(str) {
      return TEST_ALPHANUMERIC.test(str);
    };
  }
});

// node_modules/qrcode/lib/core/mode.js
var require_mode = __commonJS({
  "node_modules/qrcode/lib/core/mode.js"(exports) {
    var VersionCheck = require_version_check();
    var Regex = require_regex();
    exports.NUMERIC = {
      id: "Numeric",
      bit: 1 << 0,
      ccBits: [10, 12, 14]
    };
    exports.ALPHANUMERIC = {
      id: "Alphanumeric",
      bit: 1 << 1,
      ccBits: [9, 11, 13]
    };
    exports.BYTE = {
      id: "Byte",
      bit: 1 << 2,
      ccBits: [8, 16, 16]
    };
    exports.KANJI = {
      id: "Kanji",
      bit: 1 << 3,
      ccBits: [8, 10, 12]
    };
    exports.MIXED = {
      bit: -1
    };
    exports.getCharCountIndicator = function getCharCountIndicator(mode, version) {
      if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid version: " + version);
      }
      if (version >= 1 && version < 10) return mode.ccBits[0];
      else if (version < 27) return mode.ccBits[1];
      return mode.ccBits[2];
    };
    exports.getBestModeForData = function getBestModeForData(dataStr) {
      if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
      else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
      else if (Regex.testKanji(dataStr)) return exports.KANJI;
      else return exports.BYTE;
    };
    exports.toString = function toString(mode) {
      if (mode && mode.id) return mode.id;
      throw new Error("Invalid mode");
    };
    exports.isValid = function isValid(mode) {
      return mode && mode.bit && mode.ccBits;
    };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "numeric":
          return exports.NUMERIC;
        case "alphanumeric":
          return exports.ALPHANUMERIC;
        case "kanji":
          return exports.KANJI;
        case "byte":
          return exports.BYTE;
        default:
          throw new Error("Unknown mode: " + string);
      }
    }
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// node_modules/qrcode/lib/core/version.js
var require_version = __commonJS({
  "node_modules/qrcode/lib/core/version.js"(exports) {
    var Utils = require_utils();
    var ECCode = require_error_correction_code();
    var ECLevel = require_error_correction_level();
    var Mode = require_mode();
    var VersionCheck = require_version_check();
    var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    var G18_BCH = Utils.getBCHDigit(G18);
    function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    function getReservedBitsCount(mode, version) {
      return Mode.getCharCountIndicator(mode, version) + 4;
    }
    function getTotalBitsFromDataArray(segments, version) {
      let totalBits = 0;
      segments.forEach(function(data) {
        const reservedBits = getReservedBitsCount(data.mode, version);
        totalBits += reservedBits + data.getBitsLength();
      });
      return totalBits;
    }
    function getBestVersionForMixedData(segments, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        const length = getTotalBitsFromDataArray(segments, currentVersion);
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    exports.from = function from(value, defaultValue) {
      if (VersionCheck.isValid(value)) {
        return parseInt(value, 10);
      }
      return defaultValue;
    };
    exports.getCapacity = function getCapacity(version, errorCorrectionLevel, mode) {
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid QR Code version");
      }
      if (typeof mode === "undefined") mode = Mode.BYTE;
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (mode === Mode.MIXED) return dataTotalCodewordsBits;
      const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
      switch (mode) {
        case Mode.NUMERIC:
          return Math.floor(usableBits / 10 * 3);
        case Mode.ALPHANUMERIC:
          return Math.floor(usableBits / 11 * 2);
        case Mode.KANJI:
          return Math.floor(usableBits / 13);
        case Mode.BYTE:
        default:
          return Math.floor(usableBits / 8);
      }
    };
    exports.getBestVersionForData = function getBestVersionForData(data, errorCorrectionLevel) {
      let seg;
      const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
      if (Array.isArray(data)) {
        if (data.length > 1) {
          return getBestVersionForMixedData(data, ecl);
        }
        if (data.length === 0) {
          return 1;
        }
        seg = data[0];
      } else {
        seg = data;
      }
      return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
    };
    exports.getEncodedBits = function getEncodedBits(version) {
      if (!VersionCheck.isValid(version) || version < 7) {
        throw new Error("Invalid QR Code version");
      }
      let d = version << 12;
      while (Utils.getBCHDigit(d) - G18_BCH >= 0) {
        d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
      }
      return version << 12 | d;
    };
  }
});

// node_modules/qrcode/lib/core/format-info.js
var require_format_info = __commonJS({
  "node_modules/qrcode/lib/core/format-info.js"(exports) {
    var Utils = require_utils();
    var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    var G15_BCH = Utils.getBCHDigit(G15);
    exports.getEncodedBits = function getEncodedBits(errorCorrectionLevel, mask) {
      const data = errorCorrectionLevel.bit << 3 | mask;
      let d = data << 10;
      while (Utils.getBCHDigit(d) - G15_BCH >= 0) {
        d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
      }
      return (data << 10 | d) ^ G15_MASK;
    };
  }
});

// node_modules/qrcode/lib/core/numeric-data.js
var require_numeric_data = __commonJS({
  "node_modules/qrcode/lib/core/numeric-data.js"(exports, module) {
    var Mode = require_mode();
    function NumericData(data) {
      this.mode = Mode.NUMERIC;
      this.data = data.toString();
    }
    NumericData.getBitsLength = function getBitsLength(length) {
      return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
    };
    NumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    NumericData.prototype.getBitsLength = function getBitsLength() {
      return NumericData.getBitsLength(this.data.length);
    };
    NumericData.prototype.write = function write(bitBuffer) {
      let i, group, value;
      for (i = 0; i + 3 <= this.data.length; i += 3) {
        group = this.data.substr(i, 3);
        value = parseInt(group, 10);
        bitBuffer.put(value, 10);
      }
      const remainingNum = this.data.length - i;
      if (remainingNum > 0) {
        group = this.data.substr(i);
        value = parseInt(group, 10);
        bitBuffer.put(value, remainingNum * 3 + 1);
      }
    };
    module.exports = NumericData;
  }
});

// node_modules/qrcode/lib/core/alphanumeric-data.js
var require_alphanumeric_data = __commonJS({
  "node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module) {
    var Mode = require_mode();
    var ALPHA_NUM_CHARS = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      " ",
      "$",
      "%",
      "*",
      "+",
      "-",
      ".",
      "/",
      ":"
    ];
    function AlphanumericData(data) {
      this.mode = Mode.ALPHANUMERIC;
      this.data = data;
    }
    AlphanumericData.getBitsLength = function getBitsLength(length) {
      return 11 * Math.floor(length / 2) + 6 * (length % 2);
    };
    AlphanumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    AlphanumericData.prototype.getBitsLength = function getBitsLength() {
      return AlphanumericData.getBitsLength(this.data.length);
    };
    AlphanumericData.prototype.write = function write(bitBuffer) {
      let i;
      for (i = 0; i + 2 <= this.data.length; i += 2) {
        let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
        value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]);
        bitBuffer.put(value, 11);
      }
      if (this.data.length % 2) {
        bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
      }
    };
    module.exports = AlphanumericData;
  }
});

// node_modules/qrcode/lib/core/byte-data.js
var require_byte_data = __commonJS({
  "node_modules/qrcode/lib/core/byte-data.js"(exports, module) {
    var Mode = require_mode();
    function ByteData(data) {
      this.mode = Mode.BYTE;
      if (typeof data === "string") {
        this.data = new TextEncoder().encode(data);
      } else {
        this.data = new Uint8Array(data);
      }
    }
    ByteData.getBitsLength = function getBitsLength(length) {
      return length * 8;
    };
    ByteData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    ByteData.prototype.getBitsLength = function getBitsLength() {
      return ByteData.getBitsLength(this.data.length);
    };
    ByteData.prototype.write = function(bitBuffer) {
      for (let i = 0, l = this.data.length; i < l; i++) {
        bitBuffer.put(this.data[i], 8);
      }
    };
    module.exports = ByteData;
  }
});

// node_modules/qrcode/lib/core/kanji-data.js
var require_kanji_data = __commonJS({
  "node_modules/qrcode/lib/core/kanji-data.js"(exports, module) {
    var Mode = require_mode();
    var Utils = require_utils();
    function KanjiData(data) {
      this.mode = Mode.KANJI;
      this.data = data;
    }
    KanjiData.getBitsLength = function getBitsLength(length) {
      return length * 13;
    };
    KanjiData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    KanjiData.prototype.getBitsLength = function getBitsLength() {
      return KanjiData.getBitsLength(this.data.length);
    };
    KanjiData.prototype.write = function(bitBuffer) {
      let i;
      for (i = 0; i < this.data.length; i++) {
        let value = Utils.toSJIS(this.data[i]);
        if (value >= 33088 && value <= 40956) {
          value -= 33088;
        } else if (value >= 57408 && value <= 60351) {
          value -= 49472;
        } else {
          throw new Error(
            "Invalid SJIS character: " + this.data[i] + "\nMake sure your charset is UTF-8"
          );
        }
        value = (value >>> 8 & 255) * 192 + (value & 255);
        bitBuffer.put(value, 13);
      }
    };
    module.exports = KanjiData;
  }
});

// node_modules/dijkstrajs/dijkstra.js
var require_dijkstra = __commonJS({
  "node_modules/dijkstrajs/dijkstra.js"(exports, module) {
    "use strict";
    var dijkstra = {
      single_source_shortest_paths: function(graph, s, d) {
        var predecessors = {};
        var costs = {};
        costs[s] = 0;
        var open = dijkstra.PriorityQueue.make();
        open.push(s, 0);
        var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
        while (!open.empty()) {
          closest = open.pop();
          u = closest.value;
          cost_of_s_to_u = closest.cost;
          adjacent_nodes = graph[u] || {};
          for (v in adjacent_nodes) {
            if (adjacent_nodes.hasOwnProperty(v)) {
              cost_of_e = adjacent_nodes[v];
              cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
              cost_of_s_to_v = costs[v];
              first_visit = typeof costs[v] === "undefined";
              if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                costs[v] = cost_of_s_to_u_plus_cost_of_e;
                open.push(v, cost_of_s_to_u_plus_cost_of_e);
                predecessors[v] = u;
              }
            }
          }
        }
        if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
          var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
          throw new Error(msg);
        }
        return predecessors;
      },
      extract_shortest_path_from_predecessor_list: function(predecessors, d) {
        var nodes = [];
        var u = d;
        var predecessor;
        while (u) {
          nodes.push(u);
          predecessor = predecessors[u];
          u = predecessors[u];
        }
        nodes.reverse();
        return nodes;
      },
      find_path: function(graph, s, d) {
        var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
        return dijkstra.extract_shortest_path_from_predecessor_list(
          predecessors,
          d
        );
      },
      /**
       * A very naive priority queue implementation.
       */
      PriorityQueue: {
        make: function(opts) {
          var T = dijkstra.PriorityQueue, t = {}, key;
          opts = opts || {};
          for (key in T) {
            if (T.hasOwnProperty(key)) {
              t[key] = T[key];
            }
          }
          t.queue = [];
          t.sorter = opts.sorter || T.default_sorter;
          return t;
        },
        default_sorter: function(a, b) {
          return a.cost - b.cost;
        },
        /**
         * Add a new item to the queue and ensure the highest priority element
         * is at the front of the queue.
         */
        push: function(value, cost) {
          var item = { value, cost };
          this.queue.push(item);
          this.queue.sort(this.sorter);
        },
        /**
         * Return the highest priority element in the queue.
         */
        pop: function() {
          return this.queue.shift();
        },
        empty: function() {
          return this.queue.length === 0;
        }
      }
    };
    if (typeof module !== "undefined") {
      module.exports = dijkstra;
    }
  }
});

// node_modules/qrcode/lib/core/segments.js
var require_segments = __commonJS({
  "node_modules/qrcode/lib/core/segments.js"(exports) {
    var Mode = require_mode();
    var NumericData = require_numeric_data();
    var AlphanumericData = require_alphanumeric_data();
    var ByteData = require_byte_data();
    var KanjiData = require_kanji_data();
    var Regex = require_regex();
    var Utils = require_utils();
    var dijkstra = require_dijkstra();
    function getStringByteLength(str) {
      return unescape(encodeURIComponent(str)).length;
    }
    function getSegments(regex, mode, str) {
      const segments = [];
      let result;
      while ((result = regex.exec(str)) !== null) {
        segments.push({
          data: result[0],
          index: result.index,
          mode,
          length: result[0].length
        });
      }
      return segments;
    }
    function getSegmentsFromString(dataStr) {
      const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
      const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
      let byteSegs;
      let kanjiSegs;
      if (Utils.isKanjiModeEnabled()) {
        byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
        kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
      } else {
        byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
        kanjiSegs = [];
      }
      const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
      return segs.sort(function(s1, s2) {
        return s1.index - s2.index;
      }).map(function(obj) {
        return {
          data: obj.data,
          mode: obj.mode,
          length: obj.length
        };
      });
    }
    function getSegmentBitsLength(length, mode) {
      switch (mode) {
        case Mode.NUMERIC:
          return NumericData.getBitsLength(length);
        case Mode.ALPHANUMERIC:
          return AlphanumericData.getBitsLength(length);
        case Mode.KANJI:
          return KanjiData.getBitsLength(length);
        case Mode.BYTE:
          return ByteData.getBitsLength(length);
      }
    }
    function mergeSegments(segs) {
      return segs.reduce(function(acc, curr) {
        const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
        if (prevSeg && prevSeg.mode === curr.mode) {
          acc[acc.length - 1].data += curr.data;
          return acc;
        }
        acc.push(curr);
        return acc;
      }, []);
    }
    function buildNodes(segs) {
      const nodes = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        switch (seg.mode) {
          case Mode.NUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.ALPHANUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.KANJI:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
            break;
          case Mode.BYTE:
            nodes.push([
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
        }
      }
      return nodes;
    }
    function buildGraph(nodes, version) {
      const table = {};
      const graph = { start: {} };
      let prevNodeIds = ["start"];
      for (let i = 0; i < nodes.length; i++) {
        const nodeGroup = nodes[i];
        const currentNodeIds = [];
        for (let j = 0; j < nodeGroup.length; j++) {
          const node = nodeGroup[j];
          const key = "" + i + j;
          currentNodeIds.push(key);
          table[key] = { node, lastCount: 0 };
          graph[key] = {};
          for (let n = 0; n < prevNodeIds.length; n++) {
            const prevNodeId = prevNodeIds[n];
            if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
              graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
              table[prevNodeId].lastCount += node.length;
            } else {
              if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
              graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
            }
          }
        }
        prevNodeIds = currentNodeIds;
      }
      for (let n = 0; n < prevNodeIds.length; n++) {
        graph[prevNodeIds[n]].end = 0;
      }
      return { map: graph, table };
    }
    function buildSingleSegment(data, modesHint) {
      let mode;
      const bestMode = Mode.getBestModeForData(data);
      mode = Mode.from(modesHint, bestMode);
      if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
        throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
      }
      if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
        mode = Mode.BYTE;
      }
      switch (mode) {
        case Mode.NUMERIC:
          return new NumericData(data);
        case Mode.ALPHANUMERIC:
          return new AlphanumericData(data);
        case Mode.KANJI:
          return new KanjiData(data);
        case Mode.BYTE:
          return new ByteData(data);
      }
    }
    exports.fromArray = function fromArray(array) {
      return array.reduce(function(acc, seg) {
        if (typeof seg === "string") {
          acc.push(buildSingleSegment(seg, null));
        } else if (seg.data) {
          acc.push(buildSingleSegment(seg.data, seg.mode));
        }
        return acc;
      }, []);
    };
    exports.fromString = function fromString(data, version) {
      const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
      const nodes = buildNodes(segs);
      const graph = buildGraph(nodes, version);
      const path = dijkstra.find_path(graph.map, "start", "end");
      const optimizedSegs = [];
      for (let i = 1; i < path.length - 1; i++) {
        optimizedSegs.push(graph.table[path[i]].node);
      }
      return exports.fromArray(mergeSegments(optimizedSegs));
    };
    exports.rawSplit = function rawSplit(data) {
      return exports.fromArray(
        getSegmentsFromString(data, Utils.isKanjiModeEnabled())
      );
    };
  }
});

// node_modules/qrcode/lib/core/qrcode.js
var require_qrcode = __commonJS({
  "node_modules/qrcode/lib/core/qrcode.js"(exports) {
    var Utils = require_utils();
    var ECLevel = require_error_correction_level();
    var BitBuffer = require_bit_buffer();
    var BitMatrix = require_bit_matrix();
    var AlignmentPattern = require_alignment_pattern();
    var FinderPattern = require_finder_pattern();
    var MaskPattern = require_mask_pattern();
    var ECCode = require_error_correction_code();
    var ReedSolomonEncoder = require_reed_solomon_encoder();
    var Version = require_version();
    var FormatInfo = require_format_info();
    var Mode = require_mode();
    var Segments = require_segments();
    function setupFinderPattern(matrix, version) {
      const size = matrix.size;
      const pos = FinderPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -1; r <= 7; r++) {
          if (row + r <= -1 || size <= row + r) continue;
          for (let c = -1; c <= 7; c++) {
            if (col + c <= -1 || size <= col + c) continue;
            if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupTimingPattern(matrix) {
      const size = matrix.size;
      for (let r = 8; r < size - 8; r++) {
        const value = r % 2 === 0;
        matrix.set(r, 6, value, true);
        matrix.set(6, r, value, true);
      }
    }
    function setupAlignmentPattern(matrix, version) {
      const pos = AlignmentPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupVersionInfo(matrix, version) {
      const size = matrix.size;
      const bits = Version.getEncodedBits(version);
      let row, col, mod;
      for (let i = 0; i < 18; i++) {
        row = Math.floor(i / 3);
        col = i % 3 + size - 8 - 3;
        mod = (bits >> i & 1) === 1;
        matrix.set(row, col, mod, true);
        matrix.set(col, row, mod, true);
      }
    }
    function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
      const size = matrix.size;
      const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
      let i, mod;
      for (i = 0; i < 15; i++) {
        mod = (bits >> i & 1) === 1;
        if (i < 6) {
          matrix.set(i, 8, mod, true);
        } else if (i < 8) {
          matrix.set(i + 1, 8, mod, true);
        } else {
          matrix.set(size - 15 + i, 8, mod, true);
        }
        if (i < 8) {
          matrix.set(8, size - i - 1, mod, true);
        } else if (i < 9) {
          matrix.set(8, 15 - i - 1 + 1, mod, true);
        } else {
          matrix.set(8, 15 - i - 1, mod, true);
        }
      }
      matrix.set(size - 8, 8, 1, true);
    }
    function setupData(matrix, data) {
      const size = matrix.size;
      let inc = -1;
      let row = size - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!matrix.isReserved(row, col - c)) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              matrix.set(row, col - c, dark);
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || size <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    function createData(version, errorCorrectionLevel, segments) {
      const buffer = new BitBuffer();
      segments.forEach(function(data) {
        buffer.put(data.mode.bit, 4);
        buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
        data.write(buffer);
      });
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(0);
      }
      const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
      for (let i = 0; i < remainingByte; i++) {
        buffer.put(i % 2 ? 17 : 236, 8);
      }
      return createCodewords(buffer, version, errorCorrectionLevel);
    }
    function createCodewords(bitBuffer, version, errorCorrectionLevel) {
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewords = totalCodewords - ecTotalCodewords;
      const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
      const blocksInGroup2 = totalCodewords % ecTotalBlocks;
      const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
      const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
      const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
      const rs = new ReedSolomonEncoder(ecCount);
      let offset = 0;
      const dcData = new Array(ecTotalBlocks);
      const ecData = new Array(ecTotalBlocks);
      let maxDataSize = 0;
      const buffer = new Uint8Array(bitBuffer.buffer);
      for (let b = 0; b < ecTotalBlocks; b++) {
        const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
        dcData[b] = buffer.slice(offset, offset + dataSize);
        ecData[b] = rs.encode(dcData[b]);
        offset += dataSize;
        maxDataSize = Math.max(maxDataSize, dataSize);
      }
      const data = new Uint8Array(totalCodewords);
      let index = 0;
      let i, r;
      for (i = 0; i < maxDataSize; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          if (i < dcData[r].length) {
            data[index++] = dcData[r][i];
          }
        }
      }
      for (i = 0; i < ecCount; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          data[index++] = ecData[r][i];
        }
      }
      return data;
    }
    function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
      let segments;
      if (Array.isArray(data)) {
        segments = Segments.fromArray(data);
      } else if (typeof data === "string") {
        let estimatedVersion = version;
        if (!estimatedVersion) {
          const rawSegments = Segments.rawSplit(data);
          estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
        }
        segments = Segments.fromString(data, estimatedVersion || 40);
      } else {
        throw new Error("Invalid data");
      }
      const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
      if (!bestVersion) {
        throw new Error("The amount of data is too big to be stored in a QR Code");
      }
      if (!version) {
        version = bestVersion;
      } else if (version < bestVersion) {
        throw new Error(
          "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
        );
      }
      const dataBits = createData(version, errorCorrectionLevel, segments);
      const moduleCount = Utils.getSymbolSize(version);
      const modules = new BitMatrix(moduleCount);
      setupFinderPattern(modules, version);
      setupTimingPattern(modules);
      setupAlignmentPattern(modules, version);
      setupFormatInfo(modules, errorCorrectionLevel, 0);
      if (version >= 7) {
        setupVersionInfo(modules, version);
      }
      setupData(modules, dataBits);
      if (isNaN(maskPattern)) {
        maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        );
      }
      MaskPattern.applyMask(maskPattern, modules);
      setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
      return {
        modules,
        version,
        errorCorrectionLevel,
        maskPattern,
        segments
      };
    }
    exports.create = function create(data, options) {
      if (typeof data === "undefined" || data === "") {
        throw new Error("No input text");
      }
      let errorCorrectionLevel = ECLevel.M;
      let version;
      let mask;
      if (typeof options !== "undefined") {
        errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
        version = Version.from(options.version);
        mask = MaskPattern.from(options.maskPattern);
        if (options.toSJISFunc) {
          Utils.setToSJISFunction(options.toSJISFunc);
        }
      }
      return createSymbol(data, version, errorCorrectionLevel, mask);
    };
  }
});

// node_modules/qrcode/lib/renderer/utils.js
var require_utils2 = __commonJS({
  "node_modules/qrcode/lib/renderer/utils.js"(exports) {
    function hex2rgba(hex) {
      if (typeof hex === "number") {
        hex = hex.toString();
      }
      if (typeof hex !== "string") {
        throw new Error("Color should be defined as hex string");
      }
      let hexCode = hex.slice().replace("#", "").split("");
      if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
        throw new Error("Invalid hex color: " + hex);
      }
      if (hexCode.length === 3 || hexCode.length === 4) {
        hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
          return [c, c];
        }));
      }
      if (hexCode.length === 6) hexCode.push("F", "F");
      const hexValue = parseInt(hexCode.join(""), 16);
      return {
        r: hexValue >> 24 & 255,
        g: hexValue >> 16 & 255,
        b: hexValue >> 8 & 255,
        a: hexValue & 255,
        hex: "#" + hexCode.slice(0, 6).join("")
      };
    }
    exports.getOptions = function getOptions(options) {
      if (!options) options = {};
      if (!options.color) options.color = {};
      const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
      const width = options.width && options.width >= 21 ? options.width : void 0;
      const scale = options.scale || 4;
      return {
        width,
        scale: width ? 4 : scale,
        margin,
        color: {
          dark: hex2rgba(options.color.dark || "#000000ff"),
          light: hex2rgba(options.color.light || "#ffffffff")
        },
        type: options.type,
        rendererOpts: options.rendererOpts || {}
      };
    };
    exports.getScale = function getScale(qrSize, opts) {
      return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
    };
    exports.getImageWidth = function getImageWidth(qrSize, opts) {
      const scale = exports.getScale(qrSize, opts);
      return Math.floor((qrSize + opts.margin * 2) * scale);
    };
    exports.qrToImageData = function qrToImageData(imgData, qr, opts) {
      const size = qr.modules.size;
      const data = qr.modules.data;
      const scale = exports.getScale(size, opts);
      const symbolSize = Math.floor((size + opts.margin * 2) * scale);
      const scaledMargin = opts.margin * scale;
      const palette = [opts.color.light, opts.color.dark];
      for (let i = 0; i < symbolSize; i++) {
        for (let j = 0; j < symbolSize; j++) {
          let posDst = (i * symbolSize + j) * 4;
          let pxColor = opts.color.light;
          if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
            const iSrc = Math.floor((i - scaledMargin) / scale);
            const jSrc = Math.floor((j - scaledMargin) / scale);
            pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
          }
          imgData[posDst++] = pxColor.r;
          imgData[posDst++] = pxColor.g;
          imgData[posDst++] = pxColor.b;
          imgData[posDst] = pxColor.a;
        }
      }
    };
  }
});

// node_modules/qrcode/lib/renderer/canvas.js
var require_canvas = __commonJS({
  "node_modules/qrcode/lib/renderer/canvas.js"(exports) {
    var Utils = require_utils2();
    function clearCanvas(ctx, canvas, size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!canvas.style) canvas.style = {};
      canvas.height = size;
      canvas.width = size;
      canvas.style.height = size + "px";
      canvas.style.width = size + "px";
    }
    function getCanvasElement() {
      try {
        return document.createElement("canvas");
      } catch (e) {
        throw new Error("You need to specify a canvas element");
      }
    }
    exports.render = function render(qrData, canvas, options) {
      let opts = options;
      let canvasEl = canvas;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!canvas) {
        canvasEl = getCanvasElement();
      }
      opts = Utils.getOptions(opts);
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      const ctx = canvasEl.getContext("2d");
      const image = ctx.createImageData(size, size);
      Utils.qrToImageData(image.data, qrData, opts);
      clearCanvas(ctx, canvasEl, size);
      ctx.putImageData(image, 0, 0);
      return canvasEl;
    };
    exports.renderToDataURL = function renderToDataURL(qrData, canvas, options) {
      let opts = options;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!opts) opts = {};
      const canvasEl = exports.render(qrData, canvas, opts);
      const type = opts.type || "image/png";
      const rendererOpts = opts.rendererOpts || {};
      return canvasEl.toDataURL(type, rendererOpts.quality);
    };
  }
});

// node_modules/qrcode/lib/renderer/svg-tag.js
var require_svg_tag = __commonJS({
  "node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
    var Utils = require_utils2();
    function getColorAttrib(color, attrib) {
      const alpha = color.a / 255;
      const str = attrib + '="' + color.hex + '"';
      return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
    }
    function svgCmd(cmd, x, y) {
      let str = cmd + x;
      if (typeof y !== "undefined") str += " " + y;
      return str;
    }
    function qrToPath(data, size, margin) {
      let path = "";
      let moveBy = 0;
      let newRow = false;
      let lineLength = 0;
      for (let i = 0; i < data.length; i++) {
        const col = Math.floor(i % size);
        const row = Math.floor(i / size);
        if (!col && !newRow) newRow = true;
        if (data[i]) {
          lineLength++;
          if (!(i > 0 && col > 0 && data[i - 1])) {
            path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
            moveBy = 0;
            newRow = false;
          }
          if (!(col + 1 < size && data[i + 1])) {
            path += svgCmd("h", lineLength);
            lineLength = 0;
          }
        } else {
          moveBy++;
        }
      }
      return path;
    }
    exports.render = function render(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const qrcodesize = size + opts.margin * 2;
      const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
      const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
      const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
      const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
      const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path + "</svg>\n";
      if (typeof cb === "function") {
        cb(null, svgTag);
      }
      return svgTag;
    };
  }
});

// node_modules/qrcode/lib/browser.js
var require_browser = __commonJS({
  "node_modules/qrcode/lib/browser.js"(exports) {
    var canPromise = require_can_promise();
    var QRCode2 = require_qrcode();
    var CanvasRenderer = require_canvas();
    var SvgRenderer = require_svg_tag();
    function renderCanvas(renderFunc, canvas, text, opts, cb) {
      const args = [].slice.call(arguments, 1);
      const argsNum = args.length;
      const isLastArgCb = typeof args[argsNum - 1] === "function";
      if (!isLastArgCb && !canPromise()) {
        throw new Error("Callback required as last argument");
      }
      if (isLastArgCb) {
        if (argsNum < 2) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 2) {
          cb = text;
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 3) {
          if (canvas.getContext && typeof cb === "undefined") {
            cb = opts;
            opts = void 0;
          } else {
            cb = opts;
            opts = text;
            text = canvas;
            canvas = void 0;
          }
        }
      } else {
        if (argsNum < 1) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 1) {
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 2 && !canvas.getContext) {
          opts = text;
          text = canvas;
          canvas = void 0;
        }
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode2.create(text, opts);
            resolve(renderFunc(data, canvas, opts));
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode2.create(text, opts);
        cb(null, renderFunc(data, canvas, opts));
      } catch (e) {
        cb(e);
      }
    }
    exports.create = QRCode2.create;
    exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
    exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
    exports.toString = renderCanvas.bind(null, function(data, _, opts) {
      return SvgRenderer.render(data, opts);
    });
  }
});

// src/qr-renderer.ts
var import_qrcode = __toESM(require_browser(), 1);

// src/button.ts
var P_STEM = "M46.2623 100.265C43.9277 100.265 41.9617 99.5892 40.3643 98.2375C38.8898 96.8859 38.1526 95.1657 38.1526 93.0768V70.5907C38.1526 66.0444 37.1082 62.7882 35.0193 60.8222C33.0533 58.8562 30.5958 57.8732 27.6468 57.8732C24.5749 57.8732 21.9946 58.8562 19.9057 60.8222C17.9397 62.7882 16.711 65.0614 16.2195 67.6417V92.3396C16.2195 94.4284 15.4208 96.2101 13.8234 97.6846C12.3489 99.0362 10.5058 99.712 8.29404 99.712C5.95942 99.712 3.99343 99.0362 2.39606 97.6846C0.798686 96.333 0 94.6127 0 92.5239V51.238C0 49.272 0.737248 47.6132 2.21174 46.2615C3.80912 44.787 5.83655 44.0498 8.29404 44.0498C10.26 44.0498 11.9188 44.6027 13.2705 45.7086C14.6221 46.6916 15.5437 47.9818 16.0352 49.5792C19.3528 45.2785 24.3906 43.1282 31.1487 43.1282C38.0297 43.1282 43.6205 45.1557 47.9211 49.2105C52.2218 53.2654 54.3721 59.7163 54.3721 68.5633V93.4454C54.3721 95.4114 53.5734 97.0702 51.976 98.4219C50.5015 99.6506 48.597 100.265 46.2623 100.265Z";
var P_DOT = "M26.7637 0.900391C29.8673 0.900391 32.6569 1.60533 35.1299 3.01758C37.6743 4.35994 39.6881 6.26878 41.1719 8.74121C42.6585 11.1465 43.3994 13.9742 43.3994 17.2197C43.3994 20.3955 42.6579 23.2567 41.1738 25.8008C39.6892 28.2744 37.6757 30.2181 35.1328 31.6309C32.6582 33.043 29.8683 33.75 26.7637 33.75C23.9181 33.75 21.2882 33.1284 18.875 31.8867L18.3945 31.6309C15.8521 30.2184 13.8036 28.2754 12.25 25.8037C10.764 23.2567 10.0235 20.3954 10.0234 17.2197C10.0234 13.9742 10.7643 11.1466 12.25 8.74121L12.5469 8.2832C14.0617 6.03176 16.012 4.27606 18.3965 3.01758C20.9392 1.60538 23.729 0.900409 26.7637 0.900391ZM26.7637 9.63086C24.682 9.63089 22.9161 10.3241 21.4609 11.71C20.0799 13.0921 19.3857 14.9255 19.3857 17.2197C19.3858 19.4431 20.0804 21.3133 21.4658 22.8379C22.9209 24.2919 24.6846 25.0185 26.7637 25.0186C28.915 25.0186 30.6429 24.2913 31.9561 22.8398L32.208 22.5498C33.4264 21.0797 34.0361 19.3046 34.0361 17.2197C34.0361 14.9244 33.3414 13.0904 31.959 11.708L31.7061 11.4551C30.4267 10.2404 28.7819 9.63086 26.7637 9.63086Z";
function prsonMarkSvg(opts = {}) {
  const size = opts.size ?? 24;
  const square = opts.square ?? "#FBBF24";
  const glyph = opts.glyph ?? "#0A0A0A";
  return `<svg class="prson-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="6" fill="${square}"/><g transform="translate(7.2 3.15) scale(0.175)" fill="${glyph}"><path d="${P_STEM}"/><path d="${P_DOT}"/></g></svg>`;
}
var MARK_COLOURS = {
  amber: { square: "#0A0A0A", glyph: "#FBBF24" },
  dark: { square: "#FBBF24", glyph: "#0A0A0A" },
  light: { square: "#FBBF24", glyph: "#0A0A0A" },
  outline: { square: "#FBBF24", glyph: "#0A0A0A" }
};
var VARIANTS = ["amber", "dark", "light", "outline"];
function variantOf(v) {
  return VARIANTS.includes(v) ? v : "amber";
}
function decorate(btn, o) {
  const variant = variantOf(o.variant);
  btn.className = [
    "prson-signin-btn",
    `prson-signin-btn--${variant}`,
    o.size === "lg" ? "prson-signin-btn--lg" : "",
    o.fullWidth ? "prson-signin-btn--block" : ""
  ].filter(Boolean).join(" ");
  btn.innerHTML = prsonMarkSvg({ size: o.size === "lg" ? 26 : 22, ...MARK_COLOURS[variant] });
  const label = document.createElement("span");
  label.className = "prson-signin-btn__label";
  label.textContent = o.label ?? "Sign in with Prson";
  btn.append(label);
}
function createSignInButton(opts = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  decorate(btn, opts);
  if (opts.onClick) btn.addEventListener("click", opts.onClick);
  return btn;
}
function defineSignInButtonElement(tag = "prson-signin-button") {
  if (typeof window === "undefined" || !("customElements" in window) || customElements.get(tag)) return;
  class PrsonSignInButtonElement extends HTMLElement {
    constructor() {
      super(...arguments);
      this.btn = null;
    }
    static get observedAttributes() {
      return ["variant", "size", "label", "full-width", "disabled", "busy"];
    }
    connectedCallback() {
      if (!this.btn) {
        this.btn = document.createElement("button");
        this.btn.type = "button";
        this.append(this.btn);
      }
      this.render();
    }
    attributeChangedCallback() {
      if (this.btn) this.render();
    }
    render() {
      const btn = this.btn;
      decorate(btn, {
        variant: variantOf(this.getAttribute("variant")),
        size: this.getAttribute("size") === "lg" ? "lg" : "md",
        label: this.getAttribute("label") ?? void 0,
        fullWidth: this.hasAttribute("full-width")
      });
      if (this.hasAttribute("full-width")) this.style.display = "block";
      btn.disabled = this.hasAttribute("disabled");
      const busy = this.hasAttribute("busy");
      if (busy) btn.setAttribute("aria-busy", "true");
      else btn.removeAttribute("aria-busy");
      btn.classList.toggle("prson-signin-btn--busy", busy);
    }
  }
  customElements.define(tag, PrsonSignInButtonElement);
}

// src/describe.ts
function b64uDecode(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - s.length % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function param(url, name) {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    const m = url.match(new RegExp(`[?&]${name}=([^&#]*)`));
    const cap = m?.[1];
    return cap ? decodeURIComponent(cap) : null;
  }
}
var CLAIMS = {
  given_name: { icon: "user", label: "Your name" },
  family_name: { icon: "user", label: "Your name" },
  name: { icon: "user", label: "Your name" },
  full_name: { icon: "user", label: "Your name" },
  birthdate: { icon: "calendar", label: "Date of birth" },
  birth_date: { icon: "calendar", label: "Date of birth" },
  age: { icon: "calendar", label: "Your age" },
  email: { icon: "mail", label: "Email address" },
  phone: { icon: "phone", label: "Phone number" },
  phone_number: { icon: "phone", label: "Phone number" },
  address: { icon: "home", label: "Address" },
  nationality: { icon: "flag", label: "Nationality" },
  nationalities: { icon: "flag", label: "Nationality" },
  document_number: { icon: "id", label: "Document number" },
  document_type: { icon: "id", label: "Document type" },
  picture: { icon: "user", label: "Photo" }
};
var PREDICATES = {
  phone_verified: { icon: "phone", label: "A verified phone number", detail: "Not the number itself" },
  email_verified: { icon: "mail", label: "A verified email", detail: "Not the address itself" },
  address_verified: { icon: "home", label: "A verified address", detail: "Not the address itself" },
  bank_verified: { icon: "check", label: "A verified bank account", detail: "Not the account itself" }
};
function humanize(s) {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : s;
}
function predicateItem(p) {
  const known = PREDICATES[p];
  if (known) return known;
  const age = p.match(/^age_(gte|gt|over|lt|under)_(\d{1,3})$/);
  if (age) {
    const n = Number(age[2]);
    const label = age[1] === "gte" || age[1] === "over" ? `${n} or older` : age[1] === "gt" ? `Older than ${n}` : `Under ${n}`;
    return { icon: "calendar", label, detail: "Not your date of birth" };
  }
  return { icon: "check", label: humanize(p), detail: "Yes or no only" };
}
function describeShares(req) {
  const r = req.required ?? {};
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (i) => {
    if (seen.has(i.label)) return;
    seen.add(i.label);
    out.push(i);
  };
  if (r.identityType === "organization") add({ icon: "building", label: "An organisation identity" });
  const level = r.minVerificationLevel ?? 1;
  if (r.uniqueHumanId) {
    add({ icon: "shield", label: "Verified unique person", detail: "Passport or ID checked \xB7 not trackable across sites" });
  } else if (level >= 4) {
    add({ icon: "shield", label: "Verified human", detail: "Passport or ID checked" });
  } else if (level >= 1) {
    add({ icon: "shield", label: "Verified human" });
  } else {
    add({ icon: "shield", label: "Your Prson identity", detail: "Verified or not" });
  }
  for (const p of r.predicates ?? []) add(predicateItem(p));
  for (const c of r.requiredClaims ?? []) add(CLAIMS[c] ?? { icon: "check", label: humanize(c) });
  add(
    req.ephemeralIdentity ? { icon: "key", label: "A one-time key", detail: "Nothing links your visits" } : { icon: "key", label: "A sign-in key just for this site" }
  );
  return out;
}
function describeCode(url) {
  let req = {};
  const raw = param(url, "req");
  if (raw) {
    try {
      req = JSON.parse(b64uDecode(raw));
    } catch {
      req = {};
    }
  }
  const t = param(url, "t");
  const serverTs = t && /^\d+$/.test(t) ? parseInt(t, 10) : null;
  return {
    domain: param(url, "d") ?? req.domain ?? "",
    serverTs,
    shares: describeShares(req),
    anonymousAllowed: req.allowAnonymous === true
  };
}
function monogram(domain) {
  const host = domain.replace(/:\d+$/, "").toLowerCase();
  const parts = host.split(".").filter(Boolean);
  const name = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  const ch = (name ?? host).match(/[a-z0-9]/i)?.[0] ?? "?";
  return ch.toUpperCase();
}

// src/qr-renderer.ts
var DRAFT_TTL_SECONDS = 180;
var COUNTDOWN_WARN_SECONDS = 30;
var svg = (body, cls = "") => `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
var ICONS = {
  shield: svg('<path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z"/><path d="M9 12l2 2 4-4"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/>'),
  calendar: svg('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/>'),
  id: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M15 9h2M15 13h2M7 16h4"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  phone: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
  device: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
  home: svg('<path d="M5 12H3l9-9 9 9h-2"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  building: svg('<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M18 5l2 2M15 8l2 2"/>'),
  flag: svg('<path d="M5 5a5 5 0 0 1 7 0 5 5 0 0 0 7 0v9a5 5 0 0 1-7 0 5 5 0 0 0-7 0V5z"/><path d="M5 21v-7"/>'),
  check: svg('<path d="M5 12l5 5L20 7"/>'),
  close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  refresh: svg('<path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4"/>')
};
var SPINNER = svg('<path d="M12 3a9 9 0 1 0 9 9" />', "prson-spinner");
var CHECK = `<svg class="prson-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
var MONO_TINTS = ["#FEF3C7", "#E0F2FE", "#DCFCE7", "#EDE9FE", "#FCE7F3", "#E2E8F0", "#FFEDD5"];
function tintFor(domain) {
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = h * 31 + domain.charCodeAt(i) >>> 0;
  return MONO_TINTS[h % MONO_TINTS.length];
}
function fmtSeconds(seconds) {
  const s = Math.max(0, seconds);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function isPhone() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod|Android.+Mobile|Windows Phone|Mobile Safari/i.test(ua)) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(max-width: 820px)").matches;
}
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== void 0) e.innerHTML = html;
  return e;
}
function renderQrCard(url, mount, theme, context) {
  Array.from(mount.querySelectorAll(".prson-card, .prson-qr-card")).forEach((orphan) => orphan.remove());
  const info = describeCode(url);
  const domain = context?.domain || info.domain || window.location.host;
  const mode = context?.mode ?? "inline";
  const titleId = context?.titleId ?? `prson-login-title-${Math.random().toString(36).slice(2, 10)}`;
  const getAppUrl = context?.getAppUrl ?? "https://app.prson.net/";
  const phone = isPhone();
  const sheet = mode === "modal" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 480px)").matches;
  const card = el("section", "prson-card");
  card.setAttribute("data-prson-login-ui", "1");
  card.dataset.theme = theme === "light" || theme === "dark" ? theme : "auto";
  card.dataset.mode = mode;
  card.dataset.device = phone ? "phone" : "desktop";
  card.dataset.state = "waiting";
  if (sheet) card.dataset.sheet = "1";
  card.setAttribute("aria-labelledby", titleId);
  card.classList.add("prson-qr-card");
  const head = el("div", "prson-head");
  const brand = el("span", "prson-brand", prsonMarkSvg({ size: 22 }));
  brand.append(document.createTextNode("Sign in with Prson"));
  head.append(brand);
  if (mode === "modal" && context?.cancel) {
    const close = el("button", "prson-close", ICONS.close);
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => context.cancel?.());
    head.append(close);
  }
  const site = el("div", "prson-site");
  const mono = el("div", "prson-monogram");
  mono.textContent = monogram(domain);
  mono.style.setProperty("--prson-mono-bg", tintFor(domain));
  mono.setAttribute("aria-hidden", "true");
  const siteText = el("div", "prson-site-text");
  const eyebrow = el("p", "prson-eyebrow");
  eyebrow.textContent = "Sign in to";
  const title = el("h2", "prson-domain");
  title.id = titleId;
  title.textContent = domain;
  title.setAttribute("aria-label", `Sign in to ${domain}`);
  siteText.append(eyebrow, title);
  site.append(mono, siteText);
  const stage = el("div", "prson-stage");
  const frame = el("div", "prson-frame");
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("class", "prson-ring");
  ring.setAttribute("viewBox", "0 0 272 272");
  ring.setAttribute("aria-hidden", "true");
  ring.innerHTML = '<rect class="prson-ring-track" x="2" y="2" width="268" height="268" rx="24" pathLength="100"/><rect class="prson-ring-fill" x="2" y="2" width="268" height="268" rx="24" pathLength="100"/>';
  const ringFill = ring.querySelector(".prson-ring-fill");
  const code = el("div", "prson-code");
  code.setAttribute("role", "img");
  code.setAttribute("aria-label", `Sign-in code for ${domain}. Scan it with the Prson app.`);
  import_qrcode.default.toString(
    url,
    { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#0A0A0A", light: "#FFFFFF" } },
    (err, svgString) => {
      if (err) {
        code.textContent = "The code couldn't be drawn. Use Get a new code.";
        return;
      }
      code.innerHTML = svgString.replace("<svg ", '<svg class="prson-qr" aria-hidden="true" focusable="false" ');
      const logo = el("span", "prson-code-logo", prsonMarkSvg({ size: 36 }));
      code.append(logo);
    }
  );
  frame.append(ring, code);
  const open = el("div", "prson-open");
  const openBtn = el("a", "prson-btn prson-btn--big", prsonMarkSvg({ size: 26, square: "#0A0A0A", glyph: "#FBBF24" }));
  openBtn.href = url;
  openBtn.append(document.createTextNode("Open Prson"));
  const showCode = el("button", "prson-linkish");
  showCode.type = "button";
  showCode.textContent = "Scan with another phone instead";
  showCode.setAttribute("aria-expanded", "false");
  showCode.addEventListener("click", () => {
    const on = card.dataset.showCode !== "1";
    card.dataset.showCode = on ? "1" : "";
    showCode.setAttribute("aria-expanded", String(on));
    showCode.textContent = on ? "Hide the code" : "Scan with another phone instead";
  });
  open.append(openBtn, showCode);
  const overlay = el("div", "prson-overlay");
  const overlayIcon = el("div", "prson-overlay-icon");
  const overlayTitle = el("p", "prson-overlay-title");
  const overlayText = el("p", "prson-overlay-text");
  overlay.append(overlayIcon, overlayTitle, overlayText);
  (phone ? open : frame).append(overlay);
  const timer = el("p", "prson-timer");
  stage.append(frame, open);
  if (!phone) stage.append(el("p", "prson-hint", "Open <b>Prson</b> on your phone and scan this code."));
  stage.append(timer);
  const share = el("div", "prson-share");
  const shareTitle = el("p", "prson-share-title");
  shareTitle.textContent = `${domain} will get`;
  const list = el("ul");
  list.setAttribute("aria-label", `What ${domain} will get`);
  for (const item of info.shares) {
    const li = el("li", "", ICONS[item.icon]);
    const text = el("span");
    text.textContent = item.label;
    if (item.detail) {
      const small = el("small");
      small.textContent = item.detail;
      text.append(small);
    }
    li.append(text);
    list.append(li);
  }
  share.append(shareTitle, list);
  if (info.anonymousAllowed) {
    const note = el("p", "prson-share-note");
    note.textContent = "You can also choose to sign in anonymously in the app.";
    share.append(note);
  }
  const guard = el("p", "prson-guard", ICONS.lock);
  const guardText = el("span");
  guardText.append(document.createTextNode("Only scan codes shown on "));
  const guardDomain = el("b");
  guardDomain.textContent = domain;
  guardText.append(guardDomain, document.createTextNode(". Never scan one someone sent you."));
  guard.append(guardText);
  const foot = el("p", "prson-foot");
  foot.append(document.createTextNode("Don't have Prson? "));
  const get = el("a");
  get.href = getAppUrl;
  get.target = "_blank";
  get.rel = "noopener";
  get.textContent = "Get the app";
  foot.append(get);
  const live = el("div", "prson-sr");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("role", "status");
  card.append(head, site, stage, share, guard, foot, live);
  mount.append(card);
  const announce = (text) => {
    live.textContent = "";
    setTimeout(() => live.textContent = text, 50);
  };
  announce(phone ? `Sign in to ${domain}. Open Prson to continue.` : `Sign in to ${domain}. Scan the code with the Prson app.`);
  const nowS = Date.now() / 1e3;
  const startS = info.serverTs && Math.abs(nowS - info.serverTs) < 60 ? info.serverTs : nowS;
  const deadlineMs = (startS + DRAFT_TTL_SECONDS) * 1e3;
  let tickHandle = null;
  let expired = false;
  let warned = false;
  let settled = false;
  const timers = [];
  function action(label, icon, onClick) {
    const b = el("button", "prson-btn", icon);
    b.type = "button";
    b.append(document.createTextNode(label));
    b.addEventListener("click", onClick);
    return b;
  }
  function requestRefresh() {
    card.dispatchEvent(new CustomEvent("prson-login-refresh-requested", { bubbles: true }));
    context?.refresh?.();
  }
  function setOverlay(icon, titleText, text, button, pulse = false) {
    overlayIcon.innerHTML = icon;
    overlayIcon.classList.toggle("prson-pulse", pulse);
    overlayTitle.textContent = titleText;
    overlayText.textContent = text;
    overlay.querySelector(".prson-btn")?.remove();
    if (button) {
      overlay.append(button);
      if (mount.contains(document.activeElement) || mode === "modal") setTimeout(() => button.focus(), 30);
    }
  }
  function tick() {
    if (settled) return;
    const remainingMs = deadlineMs - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1e3));
    const ratio = Math.max(0, Math.min(1, remainingMs / (DRAFT_TTL_SECONDS * 1e3)));
    ringFill.style.strokeDashoffset = String(100 - ratio * 100);
    if (remaining > 0) {
      timer.innerHTML = `Code expires in <b>${fmtSeconds(remaining)}</b>`;
      card.dataset.urgency = remaining <= COUNTDOWN_WARN_SECONDS ? "warn" : "";
      if (remaining <= COUNTDOWN_WARN_SECONDS && !warned) {
        warned = true;
        announce("30 seconds left on this code.");
      }
    } else if (!expired && card.dataset.state === "waiting") {
      expired = true;
      card.dataset.state = "expired";
      timer.textContent = "";
      setOverlay(ICONS.clock, "This code expired", "Codes last 3 minutes, so a copied one is useless.", action("Get a new code", ICONS.refresh, requestRefresh));
      announce("The code expired. Get a new code to continue.");
    }
  }
  tick();
  tickHandle = window.setInterval(tick, 1e3);
  return {
    dispose() {
      if (tickHandle != null) window.clearInterval(tickHandle);
      tickHandle = null;
      timers.forEach((t) => window.clearTimeout(t));
      card.remove();
    },
    update(s) {
      if (!card.isConnected) return;
      card.dataset.state = s.state;
      switch (s.state) {
        case "waiting":
          return;
        case "scanned":
          setOverlay(ICONS.device, "Phone connected", "Finishing on your phone\u2026", void 0, true);
          announce("Phone connected. Finishing on your phone.");
          return;
        case "approving":
          setOverlay(SPINNER, "Receiving your proof", "Your phone is sending a signed, encrypted proof.");
          return;
        case "verifying":
          setOverlay(SPINNER, "Checking the proof", "Almost there.");
          announce("Checking the proof.");
          return;
        case "success": {
          settled = true;
          setOverlay(CHECK, "Signed in", `You're signed in to ${s.domain || domain}.`);
          announce(`You're signed in to ${s.domain || domain}.`);
          const hold = prefersReducedMotion() ? 450 : 1e3;
          return new Promise((resolve) => timers.push(window.setTimeout(resolve, hold)));
        }
        case "error":
          settled = true;
          timer.textContent = "";
          setOverlay(ICONS.alert, "Sign-in didn't finish", s.message, action("Try again", ICONS.refresh, requestRefresh));
          announce(`Sign-in didn't finish. ${s.message}`);
          return;
      }
    }
  };
}

// src/styles.ts
var DARK_VARS = `
    --prson-bg: #18181B;
    --prson-fg: #FAFAFA;
    --prson-muted: #A1A1AA;
    --prson-soft: #232327;
    --prson-line: rgba(255, 255, 255, 0.10);
    --prson-line-strong: rgba(255, 255, 255, 0.20);
    --prson-accent-text: #FBBF24;
    --prson-focus: #FBBF24;
    --prson-danger: #FCA5A5;
    --prson-danger-soft: rgba(248, 113, 113, 0.14);
    --prson-ring-track: rgba(255, 255, 255, 0.12);
    --prson-shadow: 0 24px 64px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4);`;
var PRSON_LOGIN_UI_CSS = `
[data-prson-login-ui] {
  --prson-bg: #FFFFFF;
  --prson-fg: #0A0A0A;
  --prson-muted: #52525B;
  --prson-soft: #FAFAF9;
  --prson-line: rgba(10, 10, 10, 0.08);
  --prson-line-strong: rgba(10, 10, 10, 0.16);
  --prson-amber: #FBBF24;
  --prson-amber-hover: #F59E0B;
  --prson-accent-text: #B45309;
  --prson-focus: #0A0A0A;
  --prson-danger: #B91C1C;
  --prson-danger-soft: #FEF2F2;
  --prson-ring-track: rgba(10, 10, 10, 0.08);
  --prson-shadow: 0 24px 64px rgba(10, 10, 10, 0.18), 0 2px 6px rgba(10, 10, 10, 0.06);
  --prson-radius: 24px;
  --prson-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  --prson-spring: cubic-bezier(0.16, 1, 0.3, 1);
}
[data-prson-login-ui][data-theme="dark"] {${DARK_VARS}
}
@media (prefers-color-scheme: dark) {
  [data-prson-login-ui][data-theme="auto"] {${DARK_VARS}
  }
}

/* \u2500\u2500 The card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.prson-card {
  box-sizing: border-box;
  position: relative;
  width: 400px;
  max-width: 100%;
  padding: 20px 24px 20px;
  background: var(--prson-bg);
  color: var(--prson-fg);
  border: 1px solid var(--prson-line);
  border-radius: var(--prson-radius);
  box-shadow: var(--prson-shadow);
  font-family: var(--prson-font);
  font-size: 14px;
  line-height: 1.45;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  animation: prson-enter 320ms var(--prson-spring);
}
.prson-card *, .prson-card *::before, .prson-card *::after { box-sizing: border-box; }
.prson-card[data-mode="inline"] { margin-top: 24px; box-shadow: 0 8px 24px rgba(10, 10, 10, 0.06), 0 1px 3px rgba(10, 10, 10, 0.05); }
.prson-card[data-sheet="1"] {
  width: 100%;
  border-radius: var(--prson-radius) var(--prson-radius) 0 0;
  border-bottom: 0;
  padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  animation-name: prson-sheet;
}
@keyframes prson-enter { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes prson-sheet { from { transform: translateY(100%); } to { transform: none; } }

.prson-card button, .prson-card a { font-family: inherit; }
.prson-card :focus-visible { outline: 3px solid var(--prson-focus); outline-offset: 2px; border-radius: 10px; }

.prson-head { display: flex; align-items: center; gap: 8px; min-height: 44px; margin: -4px -8px 4px 0; }
.prson-brand { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--prson-muted); letter-spacing: -0.1px; }
.prson-brand .prson-mark { display: block; }
.prson-close {
  margin-left: auto; width: 44px; height: 44px; display: inline-grid; place-items: center;
  border: 0; border-radius: 12px; background: transparent; color: var(--prson-muted); cursor: pointer;
}
.prson-close:hover { background: var(--prson-soft); color: var(--prson-fg); }
.prson-close svg { width: 20px; height: 20px; }

.prson-site { display: flex; align-items: center; gap: 14px; margin: 4px 0 18px; min-width: 0; }
.prson-monogram {
  flex: none; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center;
  font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: #0A0A0A;
  background: var(--prson-mono-bg, #FEF3C7);
  box-shadow: inset 0 0 0 1px rgba(10, 10, 10, 0.06);
}
.prson-site-text { min-width: 0; }
.prson-eyebrow { margin: 0; font-size: 13px; color: var(--prson-muted); }
.prson-domain {
  margin: 0; font-size: 24px; line-height: 1.15; font-weight: 700; letter-spacing: -0.6px;
  color: var(--prson-fg); overflow-wrap: anywhere;
}

/* \u2500\u2500 The code, its frame and the countdown ring \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.prson-stage { position: relative; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.prson-frame { position: relative; width: 272px; height: 272px; max-width: 100%; aspect-ratio: 1; }
.prson-ring { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.prson-ring rect { fill: none; stroke-width: 4; }
.prson-ring .prson-ring-track { stroke: var(--prson-ring-track); }
.prson-ring .prson-ring-fill {
  stroke: var(--prson-amber); stroke-linecap: round;
  stroke-dasharray: 100 100; transition: stroke-dashoffset 1s linear, stroke 300ms ease;
}
.prson-card[data-urgency="warn"] .prson-ring-fill { stroke: #D97706; }
.prson-code {
  position: absolute; inset: 10px; border-radius: 18px; background: #FFFFFF; /* always white: cameras need contrast */
  display: grid; place-items: center; padding: 12px;
  box-shadow: inset 0 0 0 1px rgba(10, 10, 10, 0.06);
  transition: filter 300ms ease, opacity 300ms ease;
}
.prson-code svg.prson-qr { display: block; width: 100%; height: 100%; }
.prson-code-logo {
  position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  border-radius: 12px; background: #FFFFFF; display: grid; place-items: center;
}
.prson-code-logo .prson-mark { width: 36px; height: 36px; }
.prson-card[data-state]:not([data-state="waiting"]) .prson-code { filter: blur(3px); opacity: 0.25; }
.prson-card[data-state="waiting"] .prson-code { filter: none; opacity: 1; }

.prson-overlay {
  position: absolute; inset: 10px; border-radius: 18px; display: none;
  flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 18px; text-align: center;
  background: var(--prson-bg);
  background: color-mix(in srgb, var(--prson-bg) 82%, transparent);
  animation: prson-fade 220ms ease;
}
.prson-card:not([data-state="waiting"]) .prson-overlay { display: flex; }
@keyframes prson-fade { from { opacity: 0; } to { opacity: 1; } }
.prson-overlay-icon { width: 56px; height: 56px; display: grid; place-items: center; border-radius: 50%; margin-bottom: 6px; background: var(--prson-soft); color: var(--prson-fg); }
.prson-overlay-icon svg { width: 28px; height: 28px; }
.prson-overlay-title { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.3px; color: var(--prson-fg); }
.prson-overlay-text { margin: 0; font-size: 13.5px; color: var(--prson-muted); max-width: 230px; }
.prson-overlay .prson-btn { margin-top: 10px; }
.prson-card[data-state="error"] .prson-overlay-icon { background: var(--prson-danger-soft); color: var(--prson-danger); }

.prson-spinner { width: 28px; height: 28px; animation: prson-spin 900ms linear infinite; }
@keyframes prson-spin { to { transform: rotate(360deg); } }
.prson-pulse { animation: prson-pulse 1.6s ease-in-out infinite; }
@keyframes prson-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.45); } 50% { box-shadow: 0 0 0 10px rgba(251, 191, 36, 0); } }

/* Success: an amber disc pops in and the check draws itself. */
.prson-card[data-state="success"] .prson-overlay-icon { background: var(--prson-amber); color: #0A0A0A; width: 72px; height: 72px; animation: prson-pop 420ms var(--prson-spring); }
.prson-card[data-state="success"] .prson-overlay-icon svg { width: 36px; height: 36px; }
.prson-check path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: prson-draw 380ms 160ms ease-out forwards; }
@keyframes prson-pop { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
@keyframes prson-draw { to { stroke-dashoffset: 0; } }
.prson-card[data-state="success"] .prson-ring-fill { stroke: var(--prson-amber); stroke-dashoffset: 0 !important; }

.prson-timer { margin: 0; min-height: 20px; font-size: 13px; color: var(--prson-muted); font-variant-numeric: tabular-nums; }
.prson-timer b { color: var(--prson-fg); font-weight: 600; }
.prson-card[data-urgency="warn"] .prson-timer b { color: var(--prson-accent-text); }
.prson-card[data-state="success"] .prson-timer, .prson-card[data-state="error"] .prson-timer { visibility: hidden; }
.prson-hint { margin: 0; font-size: 13px; color: var(--prson-muted); text-align: center; }
.prson-card:not([data-state="waiting"]) .prson-hint { visibility: hidden; }
.prson-hint b { color: var(--prson-fg); font-weight: 600; }

/* \u2500\u2500 Phones: one big "Open Prson" button \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.prson-open { position: relative; display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 10px; width: 100%; }
.prson-card[data-device="phone"] .prson-frame { display: none; }
.prson-card[data-device="phone"][data-show-code="1"] .prson-frame { display: block; }
.prson-card[data-device="desktop"] .prson-open { display: none; }
.prson-card[data-device="phone"] .prson-overlay { inset: 0; }
.prson-card[data-device="phone"]:not([data-state="waiting"]) .prson-open { min-height: 236px; }
.prson-card[data-device="phone"]:not([data-state="waiting"]) .prson-open > :not(.prson-overlay) { visibility: hidden; }
.prson-linkish {
  min-height: 44px; border: 0; background: transparent; color: var(--prson-fg); cursor: pointer;
  font-size: 14px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px; padding: 0 8px;
}

/* \u2500\u2500 Buttons inside the card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.prson-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  min-height: 48px; padding: 0 20px; border-radius: 14px; border: 0; cursor: pointer;
  font-size: 15px; font-weight: 600; letter-spacing: -0.1px; text-decoration: none;
  background: var(--prson-amber); color: #0A0A0A;
  transition: background-color 150ms ease, transform 80ms ease;
}
.prson-btn:hover { background: var(--prson-amber-hover); }
.prson-btn:active { transform: translateY(1px); }
.prson-btn--big { min-height: 56px; font-size: 16px; border-radius: 16px; }
.prson-btn .prson-mark { flex: none; }
.prson-btn { white-space: nowrap; }
.prson-btn svg:not(.prson-mark) { flex: none; width: 20px; height: 20px; }

/* \u2500\u2500 What the site gets \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.prson-share { margin: 18px 0 0; padding: 14px 16px; border-radius: 16px; background: var(--prson-soft); border: 1px solid var(--prson-line); }
.prson-share-title { margin: 0 0 8px; font-size: 12.5px; font-weight: 600; color: var(--prson-muted); letter-spacing: 0.1px; }
.prson-share ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.prson-share li { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; color: var(--prson-fg); }
.prson-share li svg { flex: none; width: 18px; height: 18px; margin-top: 1px; color: var(--prson-fg); opacity: 0.8; }
.prson-share li small { display: block; font-size: 12.5px; color: var(--prson-muted); }
.prson-share-note { margin: 10px 0 0; font-size: 12.5px; color: var(--prson-muted); }

/* \u2500\u2500 Anti-relay cue and footer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.prson-guard { display: flex; gap: 8px; align-items: flex-start; margin: 14px 2px 0; font-size: 12.5px; color: var(--prson-muted); }
.prson-guard svg { flex: none; width: 16px; height: 16px; margin-top: 1px; }
.prson-guard b { color: var(--prson-fg); font-weight: 600; overflow-wrap: anywhere; }
.prson-foot { margin: 12px 0 0; padding-top: 12px; border-top: 1px solid var(--prson-line); font-size: 13px; color: var(--prson-muted); text-align: center; }
.prson-foot a { color: var(--prson-fg); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; display: inline-block; padding: 12px 4px; margin: -12px 0; }

.prson-sr { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 380px) {
  .prson-card { padding: 16px 16px 18px; }
  .prson-frame { width: 248px; height: 248px; }
  .prson-domain { font-size: 21px; }
}

/* \u2500\u2500 "Sign in with Prson" button (host page) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.prson-signin-btn {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  min-height: 44px; padding: 0 18px 0 12px; border-radius: 12px; cursor: pointer;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  font-size: 15px; font-weight: 600; line-height: 1; letter-spacing: -0.1px; white-space: nowrap;
  border: 1px solid transparent; text-decoration: none; -webkit-font-smoothing: antialiased;
  transition: background-color 150ms ease, border-color 150ms ease, transform 80ms ease;
}
.prson-signin-btn .prson-mark { flex: none; display: block; }
.prson-signin-btn:focus-visible { outline: 3px solid #0A0A0A; outline-offset: 2px; }
.prson-signin-btn:active:not(:disabled) { transform: translateY(1px); }
.prson-signin-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.prson-signin-btn--lg { min-height: 52px; padding: 0 22px 0 14px; font-size: 16px; border-radius: 14px; }
.prson-signin-btn--block { display: flex; width: 100%; }
.prson-signin-btn--amber { background: #FBBF24; color: #0A0A0A; }
.prson-signin-btn--amber:hover:not(:disabled) { background: #F59E0B; }
.prson-signin-btn--dark { background: #0A0A0A; color: #FFFFFF; }
.prson-signin-btn--dark:hover:not(:disabled) { background: #27272A; }
.prson-signin-btn--dark:focus-visible { outline-color: #D97706; }
.prson-signin-btn--light { background: #FFFFFF; color: #0A0A0A; border-color: rgba(10, 10, 10, 0.16); }
.prson-signin-btn--light:hover:not(:disabled) { background: #FAFAF9; border-color: rgba(10, 10, 10, 0.28); }
.prson-signin-btn--light:focus-visible { outline-color: #FBBF24; }
.prson-signin-btn--outline { background: transparent; color: inherit; border: 1.5px solid currentColor; }
.prson-signin-btn--outline:hover:not(:disabled) { background: rgba(127, 127, 127, 0.10); }
.prson-signin-btn--outline:focus-visible { outline-color: currentColor; }
.prson-signin-btn--busy { cursor: progress; }
.prson-signin-btn--busy .prson-mark { animation: prson-busy 1s ease-in-out infinite; }
@keyframes prson-busy { 50% { opacity: 0.35; } }
prson-signin-button { display: inline-block; }

@media (prefers-reduced-motion: reduce) {
  .prson-card, .prson-card *, .prson-signin-btn, .prson-signin-btn * {
    animation: none !important;
    transition: none !important;
  }
  .prson-check path { stroke-dashoffset: 0; }
  .prson-signin-btn:active:not(:disabled), .prson-btn:active { transform: none; }
}
`;
function injectStylesOnce() {
  if (typeof document === "undefined") return;
  if (document.querySelector("style[data-prson-login-ui]")) return;
  const el2 = document.createElement("style");
  el2.setAttribute("data-prson-login-ui", "1");
  el2.textContent = PRSON_LOGIN_UI_CSS;
  document.head.append(el2);
}

// src/index.ts
if (typeof window !== "undefined") {
  injectStylesOnce();
  window.__prsonLoginQrRenderer = renderQrCard;
  defineSignInButtonElement();
}
export {
  PRSON_LOGIN_UI_CSS,
  createSignInButton,
  defineSignInButtonElement,
  describeCode,
  describeShares,
  injectStylesOnce,
  monogram,
  prsonMarkSvg,
  renderQrCard
};
//# sourceMappingURL=prson-login-ui.js.map
