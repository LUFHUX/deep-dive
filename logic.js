/*
 * 深潜 · 逻辑层
 *
 * 硬约定（DESIGN v0.5.1「技术方案」）：
 *   - 本文件不碰 DOM、不碰 window、不碰 document
 *   - 不读时间、不调 Math.random —— 所有随机来自传入的 seed
 *   - 每个函数纯输入纯输出，可以整体搬到微信小游戏的 Canvas 渲染层
 *
 * v0.5.1 的两处结构性改动：
 *   1. 棋盘不再在 createGame 时生成，改成**首次点击时**生成，
 *      因为要先知道首点在哪，才能把它周围 3×3 挖空。
 *   2. 新增「暗礁标记」：纯辅助记忆，不参与任何规则判定，也不动顶部计数。
 *
 * 棋盘坐标系：扁平数组，i = y * cols + x
 */
var DeepDiveLogic = (function () {
  'use strict';

  var DEFAULTS = {
    cols: 9,
    rows: 9,
    mines: 10,
    chests: 8,
    oxygen: 100,
  oxygenCap: 100,  /* 氧气上限：任何增加都不能超过它，超出部分直接丢弃 */
    stepCost: 2,      /* 手动点击一格的行动点消耗（连锁展开免费） */
    mineCost: 10,     /* 撞到坏东西的额外消耗 */
    chestOxy: 8,      /* 普通货箱回的氧气 */
    /* 稀有箱不给常量：缺省时按 chestOxy × 2.5 推出来 */ /* 稀有货箱回的氧气 */
    rareRatio: 0.1    /* 货箱里有多少是稀有 */
    /* v20：配额已移除 —— 过关靠「找到门」或「标完雷全盘摊开」，不再收集 N 个 */
  };

  /* 格子内容 */
  var EMPTY = 0;
  var MINE = 1;
  var CHEST = 2;
  var OPEN_BOTTLE = 5;   /* 全盘摊开后「已露出但还没收」的氧气瓶 */

  /* 翻开状态 */
  var HIDDEN = 0;
  var OPEN_SAFE = 1;
  var OPEN_MINE = 2;
  var OPEN_CHEST = 3;

  /* 读数颜色 */
  var BLANK = 'blank';
  var RED = 'red';
  var BLUE = 'blue';
  var MIXED = 'mixed';

  /* 状态：v0.7 起只有「进行中」和「本层结束」两种。
   * 「通关」不再是状态，而是一个独立的标记 cleared——达标了但还能继续捞。 */
  var PLAYING = 'playing';
  var ENDED = 'ended';

  var NB_CACHE = {};

  /* ---------- 随机 ---------- */

  function makeRng(seed) {
    var s = (seed >>> 0) || 0x9E3779B9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ---------- 邻格 ---------- */

  function buildNeighbors(cols, rows) {
    var table = new Array(cols * rows);
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var list = [];
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) { continue; }
            var nx = x + dx;
            var ny = y + dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) { continue; }
            list.push(ny * cols + nx);
          }
        }
        table[y * cols + x] = list;
      }
    }
    return table;
  }

  function neighborsOf(cols, rows, i) {
    var key = cols + 'x' + rows;
    var table = NB_CACHE[key];
    if (!table) {
      table = buildNeighbors(cols, rows);
      NB_CACHE[key] = table;
    }
    return table[i];
  }

  /* ---------- 生成 ---------- */

  /*
   * 生成棋盘。
   *
   * firstIdx 给出时，把它连同周围 8 格（也就是以它为中心的 3×3）排除在暗礁和
   * 货箱之外 —— 这是 v0.5.1 第 4 条，保证首点相邻 0 个特殊物，必定触发连锁展开。
   * 棋盘边缘时 3×3 会被裁掉，但「首点的全部邻居都在排除区内」这条仍然成立。
   */
  function createBoard(cfg, rng, firstIdx) {
    var n = cfg.cols * cfg.rows;
    var cells = new Array(n);
    var banned = {};
    var i;

    for (i = 0; i < n; i++) { cells[i] = EMPTY; }

    if (firstIdx != null && firstIdx >= 0 && firstIdx < n) {
      banned[firstIdx] = true;
      var around = neighborsOf(cfg.cols, cfg.rows, firstIdx);
      for (i = 0; i < around.length; i++) { banned[around[i]] = true; }
    }

    var free = [];
    for (i = 0; i < n; i++) { if (!banned[i]) { free.push(i); } }

    var need = cfg.mines + cfg.chests;
    /* 兜底：理论上不会发生（9×9 挖掉 3×3 还剩 72，只需要 18） */
    if (free.length < need) {
      free = [];
      for (i = 0; i < n; i++) { free.push(i); }
    }

    for (i = free.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = free[i]; free[i] = free[j]; free[j] = t;
    }

    var p = 0;
    for (i = 0; i < cfg.mines; i++) { cells[free[p++]] = MINE; }
    for (i = 0; i < cfg.chests; i++) { cells[free[p++]] = CHEST; }

    return { cols: cfg.cols, rows: cfg.rows, cells: cells };
  }

  /* ---------- 读数 ---------- */

  function classify(mine, chest) {
    if (mine + chest === 0) { return BLANK; }
    if (chest === 0) { return RED; }
    if (mine === 0) { return BLUE; }
    return MIXED;
  }

  /*
   * 对每个非特殊格算出：相邻暗礁数 / 相邻货箱数 / 总数 / 颜色。
   * 特殊格自己不放读数（返回 null）——「撞暗礁不显示数字」是规则第 2 条。
   */
  function computeReadings(board) {
    var cols = board.cols;
    var rows = board.rows;
    var n = cols * rows;
    var out = new Array(n);

    for (var i = 0; i < n; i++) {
      if (board.cells[i] !== EMPTY) { out[i] = null; continue; }

      var nb = neighborsOf(cols, rows, i);
      var m = 0;
      var c = 0;
      for (var k = 0; k < nb.length; k++) {
        var t = board.cells[nb[k]];
        if (t === MINE) { m++; }
        else if (t === CHEST) { c++; }
      }
      out[i] = { mine: m, chest: c, total: m + c, color: classify(m, c) };
    }
    return out;
  }

  /* ---------- 开局 ---------- */

  /*
   * opts.firstCell：如果给了，就立刻按这个首点生成棋盘（工具、测试用）。
   * 不给的话棋盘是 null，等真正第一次点击时才生成 —— 因为要先知道点在哪格。
   */
  var RARE_MULT = 2.5;   /* 稀有箱 = 普通 × 2.5（唯一来源） */

  function createGame(opts) {
    opts = opts || {};

    var cfg = {};
    var key;
    for (key in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) { cfg[key] = DEFAULTS[key]; }
    }
    if (opts.config) {
      for (key in opts.config) {
        if (Object.prototype.hasOwnProperty.call(opts.config, key) && opts.config[key] != null) {
          cfg[key] = opts.config[key];
        }
      }
    }

    /* 稀有箱永远由普通箱推出来（×2.5），不接受外部单独指定 */
    cfg.chestRareOxy = Math.round(cfg.chestOxy * RARE_MULT);

    var seed = opts.seed == null ? 1 : (opts.seed >>> 0);
    var n = cfg.cols * cfg.rows;
    var open = new Array(n);
    var marks = new Array(n);
    for (var i = 0; i < n; i++) { open[i] = HIDDEN; marks[i] = false; }

    var state = {
      cfg: cfg,
      seed: seed,
      board: null,
      fixedBoard: opts.fixedBoard || null,
      readings: null,
      firstCell: -1,
    door: -1,          /* 门所在的氧气瓶下标 */
    doorOpened: false,
    revealedAll: false,
      open: open,
      marks: marks,
      oxygen: cfg.oxygen,
      collected: 0,
      sunk: 0,
      moves: 0,
      cleared: false,
      perfect: false,
      status: PLAYING,
      firstMove: true
    };

    if (opts.firstCell != null && opts.firstCell >= 0) {
      materialize(state, opts.firstCell);
    }

    return state;
  }

  /* 按首点位置真正铺开棋盘。首点一旦定下，整局棋盘就固定了。 */
  /*
   * 铺好盘之后再做两件事：标炸弹、标稀有货箱。
   * **棋盘布局一个字都不动** —— 暗礁总数不变，读数不变，可解性不变。
   * 都用同一个 seed 派生，所以同一个 seed 永远得到同一套炸弹。
   */
  function markSpecials(state, rng) {
    var n = state.board.cells.length;
    var rare = [];
    var chests = [];
    for (var i = 0; i < n; i++) {
      rare[i] = false;
      if (state.board.cells[i] === CHEST) { chests.push(i); }
    }
    var idx = chests.slice();
    for (var k = idx.length - 1; k > 0; k--) {
      var r = Math.floor(rng() * (k + 1));
      var t = idx[k]; idx[k] = idx[r]; idx[r] = t;
    }
    var count = Math.round(idx.length * state.cfg.rareRatio);
    for (var m = 0; m < count && m < idx.length; m++) { rare[idx[m]] = true; }
    state.chestRare = rare;
  }
  /* 门的位置只由 (seed, firstCell) 决定 —— restore 补算时用同一个函数 */
  function doorFor(state) {
    var firstIdx = state.firstCell != null ? state.firstCell : Math.floor(state.board.cells.length / 2);
    var chestList = [];
    for (var ci = 0; ci < state.board.cells.length; ci++) {
      if (state.board.cells[ci] === CHEST) { chestList.push(ci); }
    }
    if (!chestList.length) { return -1; }
    var hh = (Math.imul(state.seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(firstIdx + 1, 40503)) >>> 0;
    hh = (hh ^ (hh >>> 15)) >>> 0;
    /* v26：门绝不落在第一个瓶子上（len>1 时从 1 开始选） */
    var lo = Math.min(3, chestList.length - 1);   /* 门不落在前三个瓶子 */
    var pick = lo + Math.floor((hh / 4294967296) * (chestList.length - lo));
    if (!(pick >= lo && pick < chestList.length)) { pick = lo; }
    return chestList[pick];
  }

  function materialize(state, firstIdx) {
    var rng = makeRng(state.seed);
    /* 手写关（教学）直接给棋盘，不走生成器，也不受闸门影响 */
    if (state.fixedBoard) {
      state.board = {
        cols: state.cfg.cols,
        rows: state.cfg.rows,
        cells: state.fixedBoard.slice()
      };
    } else {
      state.board = createBoard(state.cfg, rng, firstIdx);
    }
    state.readings = computeReadings(state.board);
    state.firstCell = firstIdx;

    /*
     * v20：从所有氧气瓶里随机选一个绑定「门」。
     * 随机数由 (seed, firstIdx) 决定 —— 同 seed 同首点必然同一位置，可复现。
     */
    if (state.door == null || state.door < 0) {
      var chestList = [];
      for (var ci = 0; ci < state.board.cells.length; ci++) {
        if (state.board.cells[ci] === CHEST) { chestList.push(ci); }
      }
      if (chestList.length) {
        var hh = (Math.imul(state.seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(firstIdx + 1, 40503)) >>> 0;
        hh = (hh ^ (hh >>> 15)) >>> 0;
        var lo2 = Math.min(3, chestList.length - 1);   /* 门不落在前三个瓶子 */
        var pick2 = lo2 + Math.floor((hh / 4294967296) * (chestList.length - lo2));
        if (!(pick2 >= lo2 && pick2 < chestList.length)) { pick2 = lo2; }
        state.door = chestList[pick2];
      }
    }
    markSpecials(state, rng);
  }

  function cloneState(s) {
    return {
      cfg: s.cfg,
      seed: s.seed,
      board: s.board,
      readings: s.readings,
      firstCell: s.firstCell,
      open: s.open.slice(),
      marks: s.marks.slice(),
      oxygen: s.oxygen,
      collected: s.collected,
      sunk: s.sunk,
      moves: s.moves,
      cleared: s.cleared,
      perfect: s.perfect,
      status: s.status,
      firstMove: s.firstMove,
      chestRare: s.chestRare,
      fixedBoard: s.fixedBoard || null,
      practice: s.practice === true,
      door: s.door,
      doorOpened: s.doorOpened === true,
      revealedAll: s.revealedAll === true
    };
  }

  /* ---------- 翻开 ---------- */

  /*
   * 空白格连锁展开（规则第 1 条，扫雷式 flood fill）。
   * 空白格的相邻格必然都不是特殊物，所以这里不可能翻出暗礁或货箱——
   * 但仍然逐个校验 cells，防止以后改参数把这条不变式破坏掉。
   */
  /* 炸毁范围：以炸弹为中心的 (2*radius+1)²。半径写死在 cfg 里，方便调。 */
  /* 冲击方向：给每个被炸的格子记一个 8 向方位，裂痕才能「从撞击点向外扩散」 */

  function floodFill(state, start) {
    var cells = state.board.cells;
    var readings = state.readings;
    var cfg = state.cfg;
    var stack = [start];
    var revealed = [];

    while (stack.length) {
      var i = stack.pop();
      if (state.open[i] !== HIDDEN) { continue; }
      if (cells[i] !== EMPTY) { continue; }

      state.open[i] = OPEN_SAFE;
      state.marks[i] = false;
      revealed.push(i);

      if (readings[i] && readings[i].total === 0) {
        var nb = neighborsOf(cfg.cols, cfg.rows, i);
        for (var k = 0; k < nb.length; k++) {
          if (state.open[nb[k]] === HIDDEN) { stack.push(nb[k]); }
        }
      }
    }
    return revealed;
  }

  /*
   * 全开：所有非暗礁格都已翻开。
   *
   * 闸门保证了每局都能纯逻辑推到这一步，所以这不是运气，是「做完了」。
   * 之前全开是静默的 —— 没有结束、没有反馈，等于把最爽的一秒扔掉了（ROADMAP Round 1 第 1 条）。
   */
  function boardCleared(state) {
    if (!state.board) { return false; }
    for (var i = 0; i < state.open.length; i++) {
      if (state.open[i] === HIDDEN && state.board.cells[i] !== MINE) { return false; }
    }
    return true;
  }

  /*
   * v0.7 规则第 10 条：捞满配额只是记一个「通关」，游戏继续跑。
   * 唯一的结束条件是氧气耗尽，而且那不算失败——已捞到的货箱全部保留。
   * 理由（DESIGN）：通关后如果不再耗氧，剩下就是无压力点击，乐趣归零。
   *
   * 2026-11-02 补：全开也结束（而且是最好的那个结局）。棋盘都翻完了没什么可点的。
   */
  function evaluate(state) {
    /* v11：氧气是行动点。付不起下一次点击才结束 —— 不是「归零」才算死。 */
    if (state.oxygen < state.cfg.stepCost) { return ENDED; }
    return PLAYING;
  }

  /* 现在还能不能手动点一格 */
  function canAct(state) {
    return !!state && (state.status === PLAYING || state.doorOpened) && state.oxygen >= state.cfg.stepCost;
  }

  var NOOP = { events: [{ type: 'noop' }] };

  function noop(state) { return { state: state, events: NOOP.events }; }

  /*
   * 点开一格。
   * 返回 { state: 新状态, events: 给渲染层的事件列表 }
   * events 类型：first / reveal / mine / chest / win / lose / noop
   */
  function openCell(state, target, opts) {
    if (state.status !== PLAYING && !state.doorOpened) { return noop(state); }
    /* 付不起这一次点击就点不动 —— 状态在这里应当是 ENDED，兜一层防超支 */
    if (!canAct(state)) { return noop(state); }
    if (target < 0 || target >= state.open.length) { return noop(state); }

    /*
     * v20：全盘摊开后，氧气瓶是「已露出、未收取」的状态。
     * 点它 = 收氧气，**不再扣步成本**（格子已经打开了）。
     */
    if (state.open[target] === OPEN_BOTTLE) {
      var nb = cloneState(state);
      var ev = [];
      if (target === nb.door && !nb.doorOpened) {
        nb.doorOpened = true;
        ev.push({ type: 'door', idx: target, oxygen: nb.oxygen });
      } else {
        var bbase = (nb.chestRare && nb.chestRare[target]) ? nb.cfg.chestRareOxy : nb.cfg.chestOxy;
        var bgain = bbase * 2;
        nb.open[target] = OPEN_CHEST;
        nb.collected += 1;
        nb.oxygen = Math.min(nb.cfg.oxygenCap, nb.oxygen + bgain);
        ev.push({ type: 'chest', idx: target, collected: nb.collected, gained: bgain, doubled: true, oxygen: nb.oxygen });
      }
      return { state: nb, events: ev };
    }

    if (state.open[target] !== HIDDEN) { return noop(state); }

    var next = cloneState(state);
    var events = [];

    /*
     * v11：手动点击先付行动点，连锁展开不重复收费。
     * opts.free：这次点击是「提示替你点的」——提示已经收过 5 点，不能再收一次步数。
     */
    var free = !!(opts && opts.free);
    if (!free) {
      next.oxygen = Math.max(0, next.oxygen - next.cfg.stepCost);
      events.push({ type: 'step', idx: target, cost: next.cfg.stepCost, oxygen: next.oxygen });
    }

    if (next.firstMove) {
      /* 棋盘还没铺就在这里铺。已经铺过的绝不再动 ——
       * 「首点周围 3×3 必空」只在铺盘那一刻成立，之后棋盘就是死的。
       * 静默重建会让状态在手底下变，测试和试玩都会拿到错的东西。 */
      if (!next.board) { materialize(next, target); }
      next.firstMove = false;
      events.push({ type: 'first', idx: target });
    }

    var kind = next.board.cells[target];

    if (kind === MINE) {
      next.open[target] = OPEN_MINE;
      next.marks[target] = false;
      /* 撞暗礁：固定扣 cfg.mineCost */
      next.sunk += 1;
      var hitCost = next.cfg.mineCost;
      next.oxygen = Math.max(0, next.oxygen - hitCost);
      events.push({ type: 'mine', idx: target, cost: hitCost, oxygen: next.oxygen });
    } else if (kind === CHEST) {
      next.open[target] = OPEN_CHEST;
      next.marks[target] = false;
      next.collected += 1;
      /*
       * v11：货箱回氧。稀有 +20，普通 +8，不封顶。
       * 被炸毁过的货箱，配额照算，但**不再产出任何奖励物**。
       */      var destroyed = false;

      /* 门：打开它不给氧气，只把「剩余瓶子 ×2」打开 */
      if (target === next.door && !next.doorOpened) {
        next.doorOpened = true;
        next.collected -= 1;          /* 门不算一个氧气瓶 */
        events.push({ type: 'door', idx: target, oxygen: next.oxygen });
      } else {
        var base = (next.chestRare && next.chestRare[target]) ? next.cfg.chestRareOxy : next.cfg.chestOxy;
        /* 门开之后，尚未开启的瓶子补给翻倍 */
        var mult = (next.doorOpened || next.revealedAll) ? 2 : 1;
        var gain = destroyed ? 0 : base * mult;
        next.oxygen = next.oxygen + gain;
        if (next.oxygen > next.cfg.oxygenCap) { next.oxygen = next.cfg.oxygenCap; }
        events.push({
          type: 'chest', idx: target, collected: next.collected,
          gained: gain, destroyed: destroyed, rare: !!(next.chestRare && next.chestRare[target]),
          doubled: mult > 1, oxygen: next.oxygen
        });
      }
    } else {
      var revealed = floodFill(next, target);
      events.push({ type: 'reveal', idxs: revealed });
    }

    next.moves += 1;

    /* v20：门一开就算「可以走了」，但玩家可以继续探索；不再按收集数量判定 */
    if (!next.cleared && next.doorOpened) {
      next.cleared = true;
      events.push({ type: 'cleared' });
    }

    /* 全开：最好的结局，优先于氧气判定 */
    if (boardCleared(next)) {
      next.perfect = true;
      next.status = ENDED;
      events.push({ type: 'perfect' });
      return { state: next, events: events };
    }

    var st = evaluate(next);
    if (st === ENDED) {
      next.status = ENDED;
      events.push({ type: 'end' });
    }

    return { state: next, events: events };
  }

  /*
   * 提示的扣费（v11）。只有真的产出信息才该扣 —— 空提示不扣（DESIGN 规则 6）。
   * 付不起就返回 null，调用方自己决定怎么提示玩家。
   */
  function spendHint(state, cost) {
    if (state.status !== PLAYING) { return null; }
    if (state.oxygen < cost) { return null; }
    var next = cloneState(state);
    next.oxygen = Math.max(0, next.oxygen - cost);
    var events = [{ type: 'hint-cost', cost: cost, oxygen: next.oxygen }];
    var st = evaluate(next);
    if (st === ENDED) {
      next.status = ENDED;
      events.push({ type: 'end' });
    }
    return { state: next, events: events };
  }

  /* ---------- 暗礁标记（v0.5.1 规则第 7 条） ---------- */

  /*
   * 开关「无 ↔ 暗礁标记」，两态，不循环。
   * 纯辅助记忆：不参与任何判定，不动顶部计数，也不阻止左键翻开。
   * 已经翻开的格子不许标（标了没有意义，还会盖住读数）。
   */
  /*
   * 自动清场（方案 B）
   *
   * 达成条件（核真实棋盘，标错了不算）：
   *   1. 所有暗礁都被标记，且没有任何一格标错
   *   2. 所有货箱都已开启
   *
   * 达成后：剩下的未知安全格一次性免费翻开 —— 不扣氧气、不触发任何事件。
   * 返回 {triggered, state, revealed}；没达成时 triggered=false，state 原样返回。
   */
  function autoClearCheck(state) {
    if (!state || state.status !== PLAYING) { return { triggered: false, state: state, revealed: [] }; }
    var n = state.open.length;
    var i;
    for (i = 0; i < n; i++) {
      var c = state.board.cells[i];
      if (c === MINE) {
        if (!state.marks[i]) { return { triggered: false, state: state, revealed: [] }; }   /* 还有雷没标 */
      } else if (state.marks[i]) {
        return { triggered: false, state: state, revealed: [] };                             /* 标错了 */
      }
    }

    var next = cloneState(state);
    var revealed = [];
    for (i = 0; i < n; i++) {
      if (next.open[i] !== HIDDEN) { continue; }
      var cell = next.board.cells[i];
      if (cell === MINE) { next.open[i] = OPEN_MINE; }          /* 雷也露出来（已标好，不扣血） */
      else if (cell === CHEST) { next.open[i] = OPEN_BOTTLE; }  /* 瓶子露出，等玩家手动收 */
      else { next.open[i] = OPEN_SAFE; }
      next.marks[i] = false;
      revealed.push(i);
    }
    /* 摊开的那一下：所有瓶子立刻按双倍算，不用先点门 */
    next.revealedAll = true;
    /* 氧气一分不扣 —— 这里刻意不动 next.oxygen */
    return { triggered: true, state: next, revealed: revealed };
  }

  function toggleMark(state, target) {
    if (state.status !== PLAYING) { return noop(state); }
    if (target < 0 || target >= state.marks.length) { return noop(state); }
    if (state.open[target] !== HIDDEN) { return noop(state); }

    var next = cloneState(state);
    next.marks[target] = !next.marks[target];
    return {
      state: next,
      events: [{ type: 'mark', idx: target, on: next.marks[target] }]
    };
  }

  /* ---------- 给渲染层的只读派生值 ---------- */

  function remainingMines(s) { return s.cfg.mines - s.sunk; }
  function remainingChests(s) { return s.cfg.chests - s.collected; }
  /* v20：不再有配额概念 */
  function markedCount(s) {
    var n = 0;
    for (var i = 0; i < s.marks.length; i++) { if (s.marks[i]) { n++; } }
    return n;
  }

  return {
    DEFAULTS: DEFAULTS,
    EMPTY: EMPTY, MINE: MINE, CHEST: CHEST,
    HIDDEN: HIDDEN, OPEN_SAFE: OPEN_SAFE, OPEN_MINE: OPEN_MINE, OPEN_CHEST: OPEN_CHEST,
    BLANK: BLANK, RED: RED, BLUE: BLUE, MIXED: MIXED,
    PLAYING: PLAYING, ENDED: ENDED,
    makeRng: makeRng,
    createBoard: createBoard,
    computeReadings: computeReadings,
    createGame: createGame,
    materialize: materialize,
    doorFor: doorFor,
    RARE_MULT: RARE_MULT,
    openCell: openCell,
    spendHint: spendHint,
    canAct: canAct,
    toggleMark: toggleMark,
    autoClearCheck: autoClearCheck,
    neighborsOf: neighborsOf,
    remainingMines: remainingMines,
    remainingChests: remainingChests,
    OPEN_BOTTLE: OPEN_BOTTLE,
    markedCount: markedCount,
    boardCleared: boardCleared
  };
})();


































