/*
 * 深潜 · 提示系统 v7
 *
 * **一步推理。** 只讲「哪条读数 → 推出哪一格」，玩家看一眼就能自己数。
 *
 * v5～v6 试过「用多步文字讲完整推理链」，三轮下来每轮更正确、更难懂。
 * 那条路放弃：提示的价值不在完整，在**一眼能懂**（DESIGN v7）。
 * 所以这里不再有链、不再有「为什么」展开区、不再有两步/多步提示。
 *
 * 保留下来的都是「一条读数」或「一个计数」直接推出的结论：
 *   红格凑齐 / 红格差几块就剩几格 / 蓝格没暗礁 / 紫格现形
 *   顶部计数 / 暗礁全定 / 货箱全捞
 *   以及一步反证：假设这格是暗礁，旁边那条读数就不成立了
 *
 * 仍然遵守的硬约束：
 *   - 解释只用玩家看得见的事实（已翻开的读数、已标记的格、顶部计数）
 *   - 反证读数必须与目标格相邻
 *   - 只给能推进的结论：是暗礁 / 可以点开
 *   - 已标记的格子不作为建议目标
 *
 * 这里不碰 DOM，纯函数。
 */
var DeepDiveHint = (function () {
  'use strict';

  var L = DeepDiveLogic;
  var S = DeepDiveSolver;

  var POSS_MINE = S.POSS_MINE;
  var POSS_CHEST = S.POSS_CHEST;
  var POSS_EMPTY = S.POSS_EMPTY;
  var POSS_NOT_MINE = POSS_CHEST | POSS_EMPTY;

  /* 结论强度：确定是暗礁 > 确定安全 */
  var RANK = { mine: 0, safe: 1 };

  var HINT_MAX_COMPONENT = 32;
  var HINT_BUDGET = 600000;

  /* ---------- 小工具 ---------- */

  /* 格子名：行 A–I（纵向）+ 列 1–9（横向），例如 E3。
   * 两个轴都用数字，玩家分不清「5-3」是行还是列（DESIGN v6）。 */
  function cn(cfg, i) {
    var cols = cfg.cols;
    return String.fromCharCode(65 + Math.floor(i / cols)) + ((i % cols) + 1);
  }

  function colorName(c) {
    if (c === L.RED) { return '红'; }
    if (c === L.BLUE) { return '蓝'; }
    if (c === L.MIXED) { return '紫'; }
    return '';
  }

  function unmarked(state, list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (state.marks && state.marks[list[i]]) { continue; }
      out.push(list[i]);
    }
    return out;
  }

  /* 「旁边那一格可以点开」/「旁边 3 格都可以点开」 */
  function canClick(n) {
    return n === 1 ? '旁边那一格可以点开。' : '旁边 ' + n + ' 格都可以点开。';
  }

  /* ---------- 全量知识（只用来校验结论，绝不出现在解释里） ---------- */

  function fullKnowledge(state) {
    var poss = S.makePoss(state);
    for (var round = 0; round < 10; round++) {
      S.propagate(state, poss);
      var r = S.enumerateDeduce(state, poss, HINT_BUDGET, HINT_MAX_COMPONENT);
      if (!r.changed) { break; }
    }
    return poss;
  }

  function verify(poss, hint) {
    for (var k = 0; k < hint.targets.length; k++) {
      var p = poss[hint.targets[k]];
      if (hint.conclusion === 'safe') {
        if (p & POSS_MINE) { return false; }
      } else if (hint.conclusion === 'mine') {
        if (p !== POSS_MINE) { return false; }
      } else {
        return false;
      }
    }
    return true;
  }

  /* ---------- 一条读数还成不成立（必须按颜色分开算） ---------- */

  function tally(state, poss, j) {
    var nb = L.neighborsOf(state.cfg.cols, state.cfg.rows, j);
    var t = { sureMine: 0, sureChest: 0, candMine: 0, candChest: 0, candAny: 0 };
    for (var k = 0; k < nb.length; k++) {
      var c = nb[k];
      if (state.open[c] === L.OPEN_MINE) { t.sureMine++; continue; }
      if (state.open[c] === L.OPEN_CHEST) { t.sureChest++; continue; }
      if (state.open[c] !== L.HIDDEN) { continue; }
      var p = poss[c];
      if (p === POSS_MINE) { t.sureMine++; continue; }
      if (p === POSS_CHEST) { t.sureChest++; continue; }
      var pm = (p & POSS_MINE) !== 0;
      var pc = (p & POSS_CHEST) !== 0;
      if (pm) { t.candMine++; }
      if (pc) { t.candChest++; }
      if (pm || pc) { t.candAny++; }
    }
    return t;
  }

  function readingFeasible(state, poss, j) {
    var r = state.readings[j];
    if (!r) { return true; }
    var t = tally(state, poss, j);
    var T = r.total;

    if (r.color === L.RED) {
      /* 红：全是暗礁，不许有货箱 */
      return t.sureChest === 0 && t.sureMine <= T && t.sureMine + t.candMine >= T;
    }
    if (r.color === L.BLUE) {
      /* 蓝：全是货箱，不许有暗礁 */
      return t.sureMine === 0 && t.sureChest <= T && t.sureChest + t.candChest >= T;
    }
    /* 紫：总数对得上，而且暗礁货箱都得有 */
    return t.sureMine + t.sureChest <= T &&
      t.sureMine + t.sureChest + t.candAny >= T &&
      t.sureMine + t.candMine >= 1 &&
      t.sureChest + t.candChest >= 1;
  }

  function violationKind(state, poss, j) {
    var r = state.readings[j];
    if (!r) { return 'count-short'; }
    var t = tally(state, poss, j);
    if (r.color === L.BLUE && t.sureMine > 0) { return 'blue-has-mine'; }
    if (r.color === L.RED && t.sureChest > 0) { return 'red-has-chest'; }
    if (r.color === L.MIXED && t.sureChest + t.candChest < 1) { return 'mixed-no-chest'; }
    if (r.color === L.MIXED && t.sureMine + t.candMine < 1) { return 'mixed-no-mine'; }
    if (t.sureMine > r.total) { return 'count-over'; }
    if (t.sureMine + t.sureChest > r.total) { return 'count-over'; }
    return 'count-short';
  }

  /*
   * 一步反证：把 target 强行当成 forced，看哪条**相邻**读数当场不成立。
   * 找不到相邻的就返回 -1 —— 不编远处的坐标。
   */
  function witnessFor(state, poss, target, forced) {
    var nb = L.neighborsOf(state.cfg.cols, state.cfg.rows, target);
    var local = poss.slice();
    local[target] = forced;

    for (var i = 0; i < nb.length; i++) {
      var j = nb[i];
      if (state.open[j] !== L.OPEN_SAFE) { continue; }
      var r = state.readings[j];
      if (!r || r.total === 0) { continue; }
      if (!readingFeasible(state, local, j)) { return j; }
    }
    return -1;
  }

  function forcedPoss(poss, target, forced) {
    var local = poss.slice();
    local[target] = forced;
    return local;
  }

  /* ---------- 一条读数就能下的结论 ---------- */

  function collectVisible(state, out) {
    var cfg = state.cfg;

    for (var i = 0; i < state.open.length; i++) {
      if (state.open[i] !== L.OPEN_SAFE) { continue; }
      var r = state.readings[i];
      if (!r) { continue; }

      var nb = L.neighborsOf(cfg.cols, cfg.rows, i);
      var hidden = [];
      var seenMine = 0;
      var seenChest = 0;
      for (var k = 0; k < nb.length; k++) {
        var j = nb[k];
        if (state.open[j] === L.OPEN_MINE) { seenMine++; continue; }
        if (state.open[j] === L.OPEN_CHEST) { seenChest++; continue; }
        if (state.open[j] !== L.HIDDEN) { continue; }
        hidden.push(j);
      }
      if (!hidden.length) { continue; }

      var where = cn(cfg, i);
      var m = hidden.length;
      var targets = unmarked(state, hidden);
      if (!targets.length) { continue; }

      /* 红 N：这一圈的暗礁已经全撞到了 */
      if (r.color === L.RED && r.total - seenMine === 0) {
        out.push({
          kind: 'red-settled', source: i, targets: targets, conclusion: 'safe', quality: 0,
          text: where + ' 读数是红 ' + r.total + '，这一圈的暗礁已经全撞到了 —— ' + canClick(m)
        });
      }

      /* 红 N：还差 K 块，没翻开的正好 K 格 */
      if (r.color === L.RED && r.total - seenMine === m) {
        var need = r.total - seenMine;
        out.push({
          kind: 'red-all-mine', source: i, targets: targets, conclusion: 'mine', quality: 0,
          text: where + ' 读数是红 ' + r.total + '，还差 ' + need + ' 块暗礁，没翻开的也正好 ' +
            m + ' 格 —— ' + (m === 1 ? '这一格是暗礁' : '这 ' + m + ' 格都是暗礁') + '，标上。'
        });
      }

      /* 蓝 N：这一圈没有暗礁 */
      if (r.color === L.BLUE) {
        out.push({
          kind: 'blue-free', source: i, targets: targets, conclusion: 'safe', quality: 0,
          text: where + ' 读数是蓝 ' + r.total + '，这一圈没有暗礁 —— ' + canClick(m)
        });
      }

      /* 紫 N：特殊物全现形了 */
      if (r.color === L.MIXED && r.total - seenMine - seenChest === 0) {
        out.push({
          kind: 'mixed-settled', source: i, targets: targets, conclusion: 'safe', quality: 0,
          text: where + ' 读数是紫 ' + r.total + '，这 ' + r.total + ' 个特殊物都已经现形了 —— ' + canClick(m)
        });
      }
    }
  }

  /* ---------- 一个计数就能下的结论 ---------- */

  function collectGlobal(state, out) {
    var cfg = state.cfg;
    var hidden = [];
    for (var i = 0; i < state.open.length; i++) {
      if (state.open[i] === L.HIDDEN) { hidden.push(i); }
    }
    if (!hidden.length) { return; }

    /*
     * 只数玩家看得见的：已经撞出来的暗礁、已经捞上来的货箱、他自己标的格。
     * 不数求解器推出来的 —— 玩家屏幕上没有这些。
     */
    var knownMine = 0;
    var knownChest = 0;
    for (var j = 0; j < state.open.length; j++) {
      if (state.open[j] === L.OPEN_MINE) { knownMine++; }
      else if (state.open[j] === L.OPEN_CHEST) { knownChest++; }
      else if (state.open[j] === L.HIDDEN && state.marks && state.marks[j]) { knownMine++; }
    }

    /* 暗礁位置全定死了 → 剩下的都安全 */
    if (knownMine >= cfg.mines) {
      var safe = [];
      for (var a = 0; a < hidden.length; a++) {
        if (state.marks && state.marks[hidden[a]]) { continue; }
        safe.push(hidden[a]);
      }
      if (safe.length) {
        out.push({
          kind: 'all-mines-located', source: -1, targets: safe, conclusion: 'safe', quality: 0,
          text: '暗礁一共 ' + cfg.mines + ' 块，位置已经全定下来了 —— 剩下 ' +
            safe.length + ' 格都没有暗礁，可以点开。'
        });
      }
    }

    /* 货箱全捞完，且没翻开的正好是还没找到的那几块暗礁 */
    var unlocated = cfg.mines - knownMine;
    if (knownChest >= cfg.chests && unlocated > 0 && hidden.length === unlocated) {
      var t2 = unmarked(state, hidden);
      if (t2.length) {
        out.push({
          kind: 'all-chests-located', source: -1, targets: t2, conclusion: 'mine', quality: 0,
          text: '氧气瓶 ' + cfg.chests + ' 个全捞到了，没翻开的正好是还没找到的那 ' +
            unlocated + ' 块暗礁 —— 都是暗礁，标上。'
        });
      }
    }

    /* 顶部计数器 */
    var mineLeft = L.remainingMines(state);
    if (mineLeft === 0) {
      var t3 = unmarked(state, hidden);
      if (t3.length) {
        out.push({
          kind: 'no-mine-left', source: -1, targets: t3, conclusion: 'safe', quality: 0,
          text: '顶部显示暗礁已经全部撞到了 —— 剩下 ' + t3.length + ' 格都没有暗礁，可以点开。'
        });
      }
    } else if (mineLeft === hidden.length) {
      var t4 = unmarked(state, hidden);
      if (t4.length) {
        out.push({
          kind: 'all-hidden-mine', source: -1, targets: t4, conclusion: 'mine', quality: 0,
          text: '顶部还有 ' + mineLeft + ' 块暗礁没撞到，没翻开的也正好 ' + hidden.length +
            ' 格 —— 都是暗礁，标上。'
        });
      }
    }
  }

  /* ---------- 一步反证 ---------- */

  /*
   * 只用玩家看得见的 poss（makePoss，不做任何传播）。
   * 以前拿求解器推导后的结果当依据，玩家数不出来 —— 那种提示等于神谕。
   */
  function collectWitness(state, out) {
    var cfg = state.cfg;
    var visible = S.makePoss(state);

    for (var i = 0; i < state.open.length; i++) {
      if (state.open[i] !== L.HIDDEN) { continue; }
      if (state.marks && state.marks[i]) { continue; }

      var isMine = false;
      var w = -1;

      /* 先试「它是暗礁」：假设它不是暗礁，旁边有读数不成立吗 */
      var probeMine = witnessFor(state, visible, i, POSS_NOT_MINE);
      if (probeMine >= 0) { isMine = true; w = probeMine; }
      else {
        /* 再试「它安全」：假设它是暗礁，旁边有读数不成立吗 */
        var probeSafe = witnessFor(state, visible, i, POSS_MINE);
        if (probeSafe >= 0) { isMine = false; w = probeSafe; }
      }
      if (w < 0) { continue; }

      var r = state.readings[w];
      var local = forcedPoss(visible, i, isMine ? POSS_NOT_MINE : POSS_MINE);
      var vk = violationKind(state, local, w);
      var whereT = cn(cfg, i);
      var whereW = cn(cfg, w);
      var text;

      if (isMine) {
        text = whereT + ' 是暗礁，标上。假设它不是，' + whereW + ' 那个' +
          colorName(r.color) + ' ' + r.total + ' 就凑不齐了。';
      } else if (vk === 'blue-has-mine') {
        text = whereT + ' 可以点开。假设那里有暗礁，' + whereW + ' 那个蓝 ' +
          r.total + ' 就不成立了 —— 蓝格周围没有暗礁。';
      } else if (vk === 'mixed-no-chest') {
        text = whereT + ' 可以点开。假设那里有暗礁，' + whereW + ' 那个紫 ' +
          r.total + ' 就没有氧气瓶了。';
      } else if (vk === 'count-over') {
        var t2 = tally(state, local, w);
        var over = r.color === L.BLUE ? t2.sureChest : t2.sureMine;
        text = whereT + ' 可以点开。假设那里有暗礁，' + whereW + ' 周围就有 ' +
          over + ' 块暗礁了，比它写的 ' + r.total + ' 多。';
      } else {
        text = whereT + ' 可以点开。假设那里有暗礁，' + whereW + ' 那个' +
          colorName(r.color) + ' ' + r.total + ' 就对不上了。';
      }

      out.push({
        kind: isMine ? 'witness-mine' : 'witness-safe',
        source: w, targets: [i], conclusion: isMine ? 'mine' : 'safe', quality: 1,
        text: text
      });
    }
  }

  /* ---------- 一组读数到底定不定得死 ---------- */

  /*
   * 把「这组读数」当成已知，枚举它们圈住的所有未知格的摆法，
   * 只看这组读数成不成立，统计目标格在**所有**摆法里是不是同一个结论。
   *
   * 这是 v8 的硬条件：高亮哪组，就必须真的足以唯一推出目标。
   * 推不出来就不许亮 —— 宁愿不亮，也不能亮了却推不出。
   */
  var GROUP_CELL_CAP = 9;

  function groupCells(state, idxs) {
    var set = {};
    var list = [];
    for (var a = 0; a < idxs.length; a++) {
      var nb = L.neighborsOf(state.cfg.cols, state.cfg.rows, idxs[a]);
      for (var k = 0; k < nb.length; k++) {
        var c = nb[k];
        if (state.open[c] !== L.HIDDEN) { continue; }
        if (set[c]) { continue; }
        set[c] = true;
        list.push(c);
      }
    }
    return list;
  }

  /* 在「只认这组读数」的前提下，目标格的所有可能取值 */
  function enumerateGroup(state, idxs, cells) {
    var n = cells.length;
    var vals = new Array(n);
    var possible = {};
    for (var q = 0; q < cells.length; q++) { possible[cells[q]] = 0; }

    function readingOk(readingIdx) {
      var r = state.readings[readingIdx];
      var nb = L.neighborsOf(state.cfg.cols, state.cfg.rows, readingIdx);
      var mine = 0;
      var chest = 0;
      for (var k = 0; k < nb.length; k++) {
        var c = nb[k];
        if (state.open[c] === L.OPEN_MINE) { mine++; continue; }
        if (state.open[c] === L.OPEN_CHEST) { chest++; continue; }
        if (state.open[c] !== L.HIDDEN) { continue; }
        var at = -1;
        for (var q2 = 0; q2 < n; q2++) { if (cells[q2] === c) { at = q2; break; } }
        if (at < 0) { return false; }   /* 不在枚举范围里，说明这组不够，放弃 */
        if (vals[at] === POSS_MINE) { mine++; }
        else if (vals[at] === POSS_CHEST) { chest++; }
      }
      var T = r.total;
      if (r.color === L.RED) { return chest === 0 && mine === T; }
      if (r.color === L.BLUE) { return mine === 0 && chest === T; }
      return mine + chest === T && mine >= 1 && chest >= 1;
    }

    function walk(i) {
      if (i === n) {
        for (var a = 0; a < idxs.length; a++) { if (!readingOk(idxs[a])) { return; } }
        for (var b = 0; b < n; b++) { possible[cells[b]] |= vals[b]; }
        return;
      }
      vals[i] = POSS_MINE; walk(i + 1);
      vals[i] = POSS_CHEST; walk(i + 1);
      vals[i] = POSS_EMPTY; walk(i + 1);
    }
    walk(0);
    return possible;
  }

  /* 这组读数能不能唯一推出目标格 */
  function groupForces(state, idxs, target, conclusion) {
    if (!idxs || !idxs.length) { return false; }
    var cells = groupCells(state, idxs);
    if (!cells.length) { return false; }
    if (cells.indexOf(target) < 0) { return false; }
    if (cells.length > GROUP_CELL_CAP) { return false; }

    var possible = enumerateGroup(state, idxs, cells);
    var p = possible[target];
    if (p === 0) { return false; }
    if (conclusion === 'mine') { return p === POSS_MINE; }
    return (p & POSS_MINE) === 0;
  }

  /* 某个结论对应的一组读数（一步提示的来源读数；计数类没有读数格） */
  function groupOf(hint) {
    if (hint.source >= 0) { return [hint.source]; }
    return [];
  }

  /* ---------- 两级揭示 ---------- */

  /*
   * 第 1 级：高亮一组读数 + 它们圈住的未知格。
   *   - 有一步能讲清的推理 → 配一句话（v7 文案）
   *   - 没有 → 只高亮，不说话
   * 第 2 级由 main.js 负责（揭示目标并执行）。
   */

  /* ---------- 多拍演示：把推导过程排成动画脚本 ---------- */

  /*
   * 一步一步地推，每一步记成「依据哪条读数 → 推出哪些格」。
   * 只用玩家看得见的东西，不碰枚举。
   * 这份脚本给动画用，不给文字用。
   */
  function deriveBeats(state) {
    var cfg = state.cfg;
    var poss = S.makePoss(state);
    var beats = [];
    var cellBeat = {};

    for (var round = 0; round < 20; round++) {
      var before = beats.length;
      for (var i = 0; i < poss.length; i++) {
        if (state.open[i] !== L.OPEN_SAFE) { continue; }
        var r = state.readings[i];
        if (!r) { continue; }

        var nb = L.neighborsOf(cfg.cols, cfg.rows, i);
        var cand = [];
        var sureMine = 0;
        var sureChest = 0;
        for (var k = 0; k < nb.length; k++) {
          var c = nb[k];
          if (state.open[c] === L.OPEN_MINE) { sureMine++; continue; }
          if (state.open[c] === L.OPEN_CHEST) { sureChest++; continue; }
          if (state.open[c] !== L.HIDDEN) { continue; }
          var p = poss[c];
          if (p === POSS_MINE) { sureMine++; continue; }
          if (p === POSS_CHEST) { sureChest++; continue; }
          if (p === POSS_EMPTY || p === POSS_NOT_MINE) { continue; }
          cand.push(c);
        }
        if (!cand.length) { continue; }

        var need = r.total - sureMine - sureChest;
        var val = -1;
        if (need <= 0) { val = POSS_EMPTY; }
        else if (need === cand.length) {
          if (r.color === L.RED) { val = POSS_MINE; }
          else if (r.color === L.BLUE) { val = POSS_CHEST; }
        } else if (r.color === L.RED && r.total - sureMine === cand.length) { val = POSS_MINE; }
        else if (r.color === L.BLUE && r.total - sureChest === cand.length) { val = POSS_CHEST; }
        if (val < 0) { continue; }

        beats.push({ source: i, cells: cand.slice(), value: val });
        for (var z = 0; z < cand.length; z++) { poss[cand[z]] = val; cellBeat[cand[z]] = beats.length - 1; }
      }
      if (beats.length === before) { break; }
    }

    return { poss: poss, beats: beats, cellBeat: cellBeat };
  }

  /*
   * 给一个局面排一份演示脚本：
   *   { beats: [{source, cells}], target, conclusion }
   * 优先用「能一路演到目标」的最短链；没有就退成一步反证。
   */
  function findPlan(state) {
    var d = deriveBeats(state);
    var best = null;

    for (var i = 0; i < state.open.length; i++) {
      if (state.open[i] !== L.HIDDEN) { continue; }
      if (state.marks && state.marks[i]) { continue; }
      if (d.cellBeat[i] === undefined) { continue; }

      var gi = d.cellBeat[i];
      var chain = d.beats.slice(0, gi + 1);
      var conclusion = d.beats[gi].value === POSS_MINE ? 'mine' : 'safe';
      var plan = { beats: chain, target: i, conclusion: conclusion };
      if (!best || plan.beats.length < best.beats.length) { best = plan; }
    }

    if (best) { return best; }

    /* 退一步：用一步反证，只有一拍 */
    var ex = findEx(state);
    if (ex.hint) {
      return {
        beats: [{ source: ex.hint.source, cells: ex.hint.targets }],
        target: ex.hint.targets[0],
        conclusion: ex.hint.conclusion
      };
    }
    return null;
  }

  /* ---------- 对外 ---------- */

  function signature(h) {
    return h.kind + '|' + h.source + '|' + h.targets.slice().sort(function (a, b) { return a - b; }).join(',');
  }

  /*
   * 返回 { hint, reason }：
   *   'ok'         有提示
   *   'exhausted'  这个局面能讲的都讲过了
   *   'all-marked' 能推的结论都落在已标记的格子上
   *   'stuck'      确实推不出
   */
  function findEx(state, opts) {
    opts = opts || {};
    if (!state || state.status !== L.PLAYING) { return { hint: null, reason: 'stuck' }; }
    if (!state.board) { return { hint: null, reason: 'stuck' }; }

    var skip = opts.skip || [];
    var poss = fullKnowledge(state);
    var candidates = [];

    collectVisible(state, candidates);
    collectGlobal(state, candidates);
    collectWitness(state, candidates);

    if (!candidates.length) { return { hint: null, reason: 'all-marked' }; }

    /*
     * 排序：结论强度 → 是不是「一条读数直接读出来」→ 命中格数。
     * 一档排在任何反证前面，因为玩家不用动脑子。
     */
    candidates.sort(function (a, b) {
      var ra = RANK[a.conclusion] - RANK[b.conclusion];
      if (ra !== 0) { return ra; }
      var qa = (a.quality || 0) - (b.quality || 0);
      if (qa !== 0) { return qa; }
      return b.targets.length - a.targets.length;
    });

    var skippedAny = false;
    for (var k = 0; k < candidates.length; k++) {
      var c = candidates[k];
      c.sig = signature(c);
      if (skip.indexOf(c.sig) >= 0) { skippedAny = true; continue; }
      if (verify(poss, c)) { return { hint: c, reason: 'ok' }; }
    }

    return { hint: null, reason: skippedAny ? 'exhausted' : 'stuck' };
  }

  function find(state, opts) {
    return findEx(state, opts).hint;
  }

  return {
    find: find,
    findEx: findEx,
    signature: signature,
    fullKnowledge: fullKnowledge,
    verify: verify,
    readingFeasible: readingFeasible,
    witnessFor: witnessFor,
    groupForces: groupForces,
    findPlan: findPlan,
    deriveBeats: deriveBeats,
    enumerateGroup: enumerateGroup,
    groupOf: groupOf,
    groupCells: groupCells,
    POSS_NOT_MINE: POSS_NOT_MINE
  };
})();




