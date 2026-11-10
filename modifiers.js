/*
 * 深潜 · 难度池修饰符（DESIGN v14）
 *
 * 第 N 关 = 基准表参数 ＋ 累积修饰符。
 * **这一轮只做四个安全修饰符**（不影响可解性）；mines / sizeUp 会动可解性，单独测。
 *
 * 抽签必须可复现：同一 run seed + 同一 depth → 抽出来的完全一致，不用 Math.random。
 * 实现在这里，只碰配置数值，不碰棋盘生成、闸门、提示。
 */
var DeepDiveModifiers = (function () {
  'use strict';

  /*
   * 每个修饰符：key / 名称 / 上限 / 怎么改配置。
   * stacks = 已经叠了几层（含本关）。
   */
  var POOL = [
    {
      key: 'chestOxy',
      name: '箱子更瘦',
      short: '补给少',
      max: 4,
      desc: function (n) { return '每箱氧气 −' + n; },
      /* 只动普通箱；稀有箱永远 = 普通 × 2.5，由 run.configFor 统一算 */
      apply: function (cfg, n) { cfg.chestOxy = Math.max(1, cfg.chestOxy - n); }
    }
  ];

  function emptyStacks() {
    var out = {};
    for (var i = 0; i < POOL.length; i++) { out[POOL[i].key] = 0; }
    return out;
  }


  /* 32 位混合，纯函数：同样的输入永远同样的输出 */
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

  /* 逢 5 逢 10 是 Boss 关 */
  function isBoss(depth) {
    return depth > 0 && depth % 5 === 0;
  }

  /*
   * 抽签节奏（v14 修正）：
   *   普通关每 2 关抽 1 项（偶数关）
   *   Boss 关额外再抽 1 项
   *   → 第 1 关 0、第 2 关 1、第 3 关 1、第 4 关 2、第 5 关 3、第 6 关 4
   */
  function drawsFor(depth) {
    var base = (depth % 2 === 0) ? 1 : 0;
    return base + (isBoss(depth) ? 1 : 0);
  }

  /*
   * 抽本关的修饰符。不动入参，返回 { stacks: 新状态, added: [key...] }。
   * 池子 = 还没到上限的那几项。
   */
  function draw(runSeed, depth, stacks) {
    var next = {};
    for (var k in stacks) { if (Object.prototype.hasOwnProperty.call(stacks, k)) { next[k] = stacks[k]; } }

    var rng = rngFor(runSeed, depth, 0x5eed);
    var want = drawsFor(depth);
    var added = [];

    /* 同一关里已经抽过的，不再进第二次的池子 —— Boss 的「2 项」必须是两种不同的麻烦 */
    var pickedThisDraw = {};

    for (var d = 0; d < want; d++) {
      var open = [];
      for (var i = 0; i < POOL.length; i++) {
        var it = POOL[i];
        if (next[it.key] >= it.max) { continue; }
        if (pickedThisDraw[it.key]) { continue; }              /* 同一关不重复 */
        open.push(it);
      }
      if (!open.length) { break; }   /* 全满或只剩重复项 → 少叠一项，不硬凑 */
      var pick = open[Math.floor(rng() * open.length) % open.length];
      next[pick.key] = next[pick.key] + 1;
      pickedThisDraw[pick.key] = true;
      added.push(pick.key);
    }

    return { stacks: next, added: added };
  }

  /* 把累积修饰符应用到一份配置上（就地改） */
  function apply(cfg, stacks) {
    for (var i = 0; i < POOL.length; i++) {
      var m = POOL[i];
      var n = stacks[m.key] || 0;
      if (n > 0) { m.apply(cfg, n); }
    }
    return cfg;
  }

  /* 给界面用：这一关叠了什么 */

  /* 给界面用的短名：炸弹多 / 爆炸大 / 伤害高 / 补给少 */
  function short(stacks) {
    var out = [];
    for (var i = 0; i < POOL.length; i++) {
      var m = POOL[i];
      if ((stacks[m.key] || 0) > 0) { out.push(m.short + (stacks[m.key] > 1 ? '×' + stacks[m.key] : '')); }
    }
    return out;
  }

  return {
    POOL: POOL,
    short: short,
    emptyStacks: emptyStacks,
    isBoss: isBoss,
    drawsFor: drawsFor,
    draw: draw,
    apply: apply,
    rngFor: rngFor
  };
})();





