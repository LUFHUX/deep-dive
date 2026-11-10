/*
 * 深潜 · 阶梯配置表（v19：100 层）
 *
 * 十条档，每档 10 层。**表里给的是范围，层内按 (run seed, depth) 随机取值** ——
 * 玩家摸不出规律，但同一 seed 重跑必须完全一致。
 *
 * 第 100 关写死：9×9、暗礁 13、箱 8、配额 8、伤害 18、步 3、补给 6、无形态（纯推理）。
 *
 * 主压力（v20）：每层从「当前档可用的池子」里抽 1 个，**同档内不连续重复**，不叠加。
 */
var DeepDiveLadder = (function () {
  'use strict';

  var SIZES = {
    '6x6': [6, 6], '6x7': [6, 7],
    '7x7': [7, 7], '7x8': [7, 8],
    '8x8': [8, 8], '8x9': [8, 9],
    '9x9': [9, 9], '9x10': [9, 10],
    '9x11': [9, 11], '8x12': [8, 12],
    '7x14': [7, 14], '6x16': [6, 16],
    '5x20': [5, 20], '10x10': [10, 10], '10x20': [10, 20]
  };

  var BANDS = [
    { from: 1,  to: 10, sizes: ['6x6', '6x7'],   mines: [3, 4],   chests: 4,  hitDivisor: 5 },
    { from: 11, to: 20, sizes: ['7x7', '7x8'],   mines: [6, 7],   chests: 5,  hitDivisor: 4 },
    { from: 21, to: 30, sizes: ['8x8', '8x9'],   mines: [8, 9],   chests: 6,  hitDivisor: 4 },
    { from: 31, to: 40, sizes: ['9x9', '9x10'],  mines: [10, 11], chests: 8,  hitDivisor: 3 },
    { from: 41, to: 50, sizes: ['9x11', '8x12'], mines: [11, 12], chests: 8,  hitDivisor: 3 },
    { from: 51, to: 60, sizes: ['8x12', '7x14'], mines: [12, 12], chests: 9,  hitDivisor: 3 },
    { from: 61, to: 70, sizes: ['10x20'],        mines: [22, 24], chests: 18, hitDivisor: 2 },
    { from: 71, to: 80, sizes: ['7x14', '6x16'], mines: [12, 13], chests: 8,  hitDivisor: 2 },
    { from: 81, to: 90, sizes: ['5x20', '6x16'], mines: [13, 13], chests: 8,  hitDivisor: 2 },
    { from: 91, to: 99, sizes: ['10x10', '9x11'], mines: [14, 16], chests: 9, hitDivisor: 1 }
  ];

  var FINAL = { cols: 9, rows: 9, mines: 13, chests: 8, hitDivisor: 1 };

  var PRESSURE_NAMES = {
    none: '无',
    fuzzy: '模糊层',
    barren: '荒芜层',
    fierce: '凶相层',
    long: '长宽比收紧',
    step3: '步成本 3',
    big: '10×20 大棋盘',
    extremeLong: '极限长宽比',
    tight: '余量压到 1'
  };

  var POOLS = [
    [],
    ['none', 'fuzzy'],
    ['none', 'fuzzy', 'barren'],
    ['fuzzy', 'barren', 'fierce'],
    ['fuzzy', 'barren', 'fierce', 'long'],
    ['fuzzy', 'barren', 'fierce', 'long'],
    ['fuzzy', 'barren', 'fierce', 'long', 'big'],
    ['fuzzy', 'barren', 'fierce', 'long', 'extremeLong'],
    ['fuzzy', 'barren', 'fierce', 'long', 'extremeLong', 'tight'],
    ['none', 'fuzzy', 'barren', 'fierce', 'long', 'tight']   /* v27：档 10 不许抽 extremeLong（会把尺寸换成 5×20） */
  ];

  function bandIndex(depth) {
    for (var i = 0; i < BANDS.length; i++) {
      if (depth >= BANDS[i].from && depth <= BANDS[i].to) { return i; }
    }
    return BANDS.length - 1;
  }

  function mix(a, b) {
    var h = (a >>> 0) ^ 0x9e3779b9;
    h = (h ^ (b >>> 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function rngFor(seed, depth, salt) {
    var s = mix(mix(seed >>> 0, depth | 0), salt | 0) || 0x1a2b3c4d;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* 每层的主压力：同档内不能和上一层重复 */
  function pressureFor(depth, seed) {
    if (depth >= 100) { return 'none'; }
    var bi = bandIndex(depth);
    var pool = POOLS[bi];
    if (!pool || !pool.length) { return 'none'; }
    var rnd = rngFor(seed, depth, 0x0b0b);

    var prev = '';
    if (depth > BANDS[bi].from) { prev = pressureFor(depth - 1, seed); }

    /*
     * big（10×20）和 step3（步成本 3）互斥：两者叠加会造出不可能通关的层
     * （200 格 × 0.31 × 3 = 186 步耗，收入根本盖不住）。
     * 判断依据是「这一档的底子」，不是只看抽到的牌：
     *   档本身是 10×20 → 不许抽 step3
     *   档本身步成本 3  → 不许抽 big
     */
    var isBigBand = BANDS[bi].sizes.length === 1 && BANDS[bi].sizes[0] === '10x20';
    var isStep3Band = BANDS[bi].step >= 3;

    var choices = [];
    for (var i = 0; i < pool.length; i++) {
      var card = pool[i];
      if (card === prev) { continue; }
      if (card === 'step3' && isBigBand) { continue; }
      if (card === 'big' && isStep3Band) { continue; }
      choices.push(card);
    }
    if (!choices.length) { choices = pool.slice(); }
    return choices[Math.floor(rnd() * choices.length) % choices.length];
  }

  function sizeOf(key) { return SIZES[key] || SIZES['9x9']; }

  /* 深度 → 档（1 起） */
  function bandFor(depth) {
    for (var i = 0; i < BANDS.length; i++) {
      if (depth >= BANDS[i].from && depth <= BANDS[i].to) { return BANDS[i]; }
    }
    return BANDS[BANDS.length - 1];
  }

  function levelFor(depth, seed) {
    seed = (seed >>> 0) || 1;

    if (depth >= 100) {
      return {
        depth: 100,
        cols: FINAL.cols, rows: FINAL.rows,
        mines: FINAL.mines, chests: FINAL.chests,
        hitDivisor: FINAL.hitDivisor,
        pressure: 'none', pressureName: '无（纯推理）',
        shape: null, seed: seed
      };
    }

    var bi = bandIndex(depth);
    var band = BANDS[bi];
    var rnd = rngFor(seed, depth, 0x1234);
    var pressure = pressureFor(depth, seed);

    var sizeKey = band.sizes[Math.floor(rnd() * band.sizes.length) % band.sizes.length];
    if (pressure === 'long') { sizeKey = band.sizes[band.sizes.length - 1]; }
    else if (pressure === 'extremeLong') { sizeKey = '5x20'; }
    else if (pressure === 'big') { sizeKey = '10x20'; }

    var wh = sizeOf(sizeKey);

    var mines = band.mines[0] + Math.floor(rnd() * (band.mines[1] - band.mines[0] + 1));
    if (mines > band.mines[1]) { mines = band.mines[1]; }

    var chests = band.chests;
    var step = band.step;

    /* step3 牌已废弃（v22：步成本退出难度设计） */
    /* tight：v20 起没有配额，这条主压力只降补给 */
    /* 留至少 1 个余量：配额不能等于或超过货箱总数 */

    var shape = null;
    if (pressure === 'fuzzy') { shape = 'A'; }
    else if (pressure === 'barren') { shape = 'B'; }
    else if (pressure === 'fierce') { shape = 'C'; }

    return {
      depth: depth,
      cols: wh[0], rows: wh[1],
      mines: mines, chests: chests,
      hitDivisor: band.hitDivisor,
      pressure: pressure,
      pressureName: PRESSURE_NAMES[pressure] || pressure,
      shape: shape,
      seed: seed
    };
  }



  return {
    BANDS: BANDS,
    bandFor: bandFor,
    POOLS: POOLS,
    PRESSURE_NAMES: PRESSURE_NAMES,
    FINAL: FINAL,
    SIZES: SIZES,
    bandIndex: bandIndex,
    pressureFor: pressureFor,
    levelFor: levelFor,
  };
})();





