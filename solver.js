/*
 * 深潜 · 求解器
 *
 * 作用：模拟一个**完美推理玩家**，判断一局能否在完全不猜的情况下捞满配额。
 *
 * 与游戏本体的关系：
 *   - 只读 logic.js，不改它。同样不碰 DOM，是纯函数。
 *   - DESIGN 把「求解器」列在逻辑层里。等以后做「生成-验证-重试」的棋盘生成器时，
 *     这个文件会搬进 proto/ 一起加载；现在只给 tools/ 的批量分析用。
 *
 * 判定的标准（对应 DESIGN 未决问题 1 的后半句）：
 *   **能不能只靠「必定不是暗礁」的格子，一路捞满配额。**
 *   不要求推出全部格子，只要求凑够配额。
 *
 * 推理能力分三层，从保守到激进：
 *   1. 单格规则：一个读数里还差几个特殊物，正好等于候选格数 → 全是 / 全不是
 *   2. 全局计数：整盘还剩几块暗礁、几个货箱（完美玩家当然会用）
 *   3. 连通块穷举：把前排格子按约束关系切成互相独立的块，逐块枚举所有合法摆法，
 *      再看某一格是不是在所有摆法里都不可能（或必定）是暗礁 / 货箱
 *
 * 已知的保守之处（结果是**下界**，不是精确值）：
 *   - 连通块穷举有节点预算上限，超了这块就放弃（记 capHit）
 *   - 跨连通块的全局约束只用了简单的「全剩 / 全不是」，没做跨块 DP
 *   - 走法用贪心（先开确定的货箱，再开「邻居最多」的安全格）。
 *     真正的「存在一条不猜的路径」需要搜索走法顺序，所以真实可解率 ≥ 这里的值。
 */
var DeepDiveSolver = (function () {
  'use strict';

  var L = DeepDiveLogic;

  var POSS_MINE = 1;
  var POSS_CHEST = 2;
  var POSS_EMPTY = 4;

  var MAX_COMPONENT = 24;      /* 连通块大于这个格数就不穷举了 */
  var DEFAULT_BUDGET = 120000; /* 每个连通块的搜索节点上限 */

  /* ---------- 知识状态 ---------- */

  function makePoss(state) {
    var n = state.open.length;
    var poss = new Array(n);
    for (var i = 0; i < n; i++) {
      var o = state.open[i];
      if (o === L.OPEN_SAFE) { poss[i] = POSS_EMPTY; }
      else if (o === L.OPEN_MINE) { poss[i] = POSS_MINE; }
      else if (o === L.OPEN_CHEST) { poss[i] = POSS_CHEST; }
      else { poss[i] = POSS_MINE | POSS_CHEST | POSS_EMPTY; }
    }
    return poss;
  }

  function setPoss(poss, i, v) {
    if (poss[i] === v || v === 0) { return false; }
    poss[i] = v;
    return true;
  }

  function isHidden(state, i) { return state.open[i] === L.HIDDEN; }

  /* ---------- 第 1 层：颜色本身 ---------- */

  /* 红读数 ⇒ 邻居里一个货箱都没有；蓝读数 ⇒ 邻居里一块暗礁都没有。 */
  function applyColorRules(state, poss) {
    var cols = state.cfg.cols;
    var rows = state.cfg.rows;
    var changed = false;

    for (var i = 0; i < poss.length; i++) {
      if (state.open[i] !== L.OPEN_SAFE) { continue; }
      var r = state.readings[i];
      if (!r || r.total === 0) { continue; }

      var nb = L.neighborsOf(cols, rows, i);
      for (var k = 0; k < nb.length; k++) {
        var j = nb[k];
        if (!isHidden(state, j)) { continue; }
        if (r.color === L.RED) {
          if (setPoss(poss, j, poss[j] & ~POSS_CHEST)) { changed = true; }
        } else if (r.color === L.BLUE) {
          if (setPoss(poss, j, poss[j] & ~POSS_MINE)) { changed = true; }
        }
      }
    }
    return changed;
  }

  /* ---------- 第 2 层：单格规则 ---------- */

  function applyCountRules(state, poss) {
    var cols = state.cfg.cols;
    var rows = state.cfg.rows;
    var changed = false;

    for (var i = 0; i < poss.length; i++) {
      if (state.open[i] !== L.OPEN_SAFE) { continue; }
      var r = state.readings[i];
      if (!r) { continue; }

      var nb = L.neighborsOf(cols, rows, i);
      var sureMine = 0;
      var sureChest = 0;
      /*
       * 候选格 = 还没定性的隐藏邻居（既不是已确定的暗礁，也不是已确定的货箱）。
       * 这里如果图省事写成「非空白的全部隐藏邻居」，就会把已经推出来的暗礁
       * 重新算进候选里，下一步 need===0 时又把它们抹成安全格 —— 求解器会去踩雷。
       * 这个坑踩过一次，留着注释。
       */
      var cand = [];
      for (var k = 0; k < nb.length; k++) {
        var j = nb[k];
        if (state.open[j] === L.OPEN_MINE) { sureMine++; continue; }
        if (state.open[j] === L.OPEN_CHEST) { sureChest++; continue; }
        if (state.open[j] !== L.HIDDEN) { continue; }
        if (poss[j] === POSS_MINE) { sureMine++; continue; }
        if (poss[j] === POSS_CHEST) { sureChest++; continue; }
        if (poss[j] === POSS_EMPTY) { continue; }
        cand.push(j);
      }

      var need = r.total - sureMine - sureChest;
      if (need < 0) { need = 0; }

      if (need <= 0) {
        for (var a = 0; a < cand.length; a++) {
          if (setPoss(poss, cand[a], POSS_EMPTY)) { changed = true; }
        }
        continue;
      }
      if (need === cand.length) {
        for (var b = 0; b < cand.length; b++) {
          var v = (r.color === L.RED) ? POSS_MINE
                : (r.color === L.BLUE) ? POSS_CHEST
                : (poss[cand[b]] & (POSS_MINE | POSS_CHEST));
          if (setPoss(poss, cand[b], v)) { changed = true; }
        }
        continue;
      }
      if (r.color === L.RED) {
        if (r.total - sureMine === cand.length) {
          for (var d = 0; d < cand.length; d++) {
            if (setPoss(poss, cand[d], POSS_MINE)) { changed = true; }
          }
        }
      } else if (r.color === L.BLUE) {
        if (r.total - sureChest === cand.length) {
          for (var e = 0; e < cand.length; e++) {
            if (setPoss(poss, cand[e], POSS_CHEST)) { changed = true; }
          }
        }
      } else if (r.color === L.MIXED && sureChest === 0 && sureMine >= 1 && need === 1 && cand.length === 1) {
        /* 紫格要求至少一个货箱。已经有一块暗礁了，最后这个特殊物只能是货箱。 */
        if (setPoss(poss, cand[0], POSS_CHEST)) { changed = true; }
      }
    }
    return changed;
  }

  /* ---------- 第 3 层：全局计数 ---------- */

  function applyGlobalCounts(state, poss) {
    var cfg = state.cfg;
    var changed = false;

    var knownMine = 0;
    var knownChest = 0;
    for (var i = 0; i < poss.length; i++) {
      if (state.open[i] === L.OPEN_MINE) { knownMine++; }
      else if (state.open[i] === L.OPEN_CHEST) { knownChest++; }
      else if (state.open[i] === L.HIDDEN) {
        if (poss[i] === POSS_MINE) { knownMine++; }
        else if (poss[i] === POSS_CHEST) { knownChest++; }
      }
    }

    var mineLeft = cfg.mines - knownMine;
    var chestLeft = cfg.chests - knownChest;

    /* 还能是暗礁的未知格 */
    var mineCand = [];
    var chestCand = [];
    for (var j = 0; j < poss.length; j++) {
      if (state.open[j] !== L.HIDDEN) { continue; }
      if (poss[j] !== POSS_MINE && (poss[j] & POSS_MINE)) { mineCand.push(j); }
      if (poss[j] !== POSS_CHEST && (poss[j] & POSS_CHEST)) { chestCand.push(j); }
    }

    if (mineLeft <= 0) {
      for (var a = 0; a < mineCand.length; a++) {
        if (setPoss(poss, mineCand[a], poss[mineCand[a]] & ~POSS_MINE)) { changed = true; }
      }
    } else if (mineLeft === mineCand.length) {
      for (var b = 0; b < mineCand.length; b++) {
        if (setPoss(poss, mineCand[b], POSS_MINE)) { changed = true; }
      }
    }

    if (chestLeft <= 0) {
      for (var c = 0; c < chestCand.length; c++) {
        if (setPoss(poss, chestCand[c], poss[chestCand[c]] & ~POSS_CHEST)) { changed = true; }
      }
    } else if (chestLeft === chestCand.length) {
      for (var d = 0; d < chestCand.length; d++) {
        if (setPoss(poss, chestCand[d], POSS_CHEST)) { changed = true; }
      }
    }

    return changed;
  }

  function propagate(state, poss) {
    var changed = true;
    var rounds = 0;
    while (changed && rounds < 60) {
      rounds++;
      changed = false;
      if (applyColorRules(state, poss)) { changed = true; }
      if (applyCountRules(state, poss)) { changed = true; }
      if (applyGlobalCounts(state, poss)) { changed = true; }
    }
  }

  /* ---------- 第 4 层：连通块穷举 ---------- */

  function buildConstraints(state, poss) {
    var cols = state.cfg.cols;
    var rows = state.cfg.rows;
    var out = [];

    for (var i = 0; i < poss.length; i++) {
      if (state.open[i] !== L.OPEN_SAFE) { continue; }
      var r = state.readings[i];
      if (!r) { continue; }

      var nb = L.neighborsOf(cols, rows, i);
      var cells = [];
      var baseMine = 0;
      var baseChest = 0;

      for (var k = 0; k < nb.length; k++) {
        var j = nb[k];
        if (state.open[j] === L.OPEN_MINE) { baseMine++; continue; }
        if (state.open[j] === L.OPEN_CHEST) { baseChest++; continue; }
        if (state.open[j] !== L.HIDDEN) { continue; }
        if (poss[j] === POSS_MINE) { baseMine++; continue; }
        if (poss[j] === POSS_CHEST) { baseChest++; continue; }
        if (poss[j] === POSS_EMPTY) { continue; }
        cells.push(j);
      }

      if (!cells.length) { continue; }

      out.push({
        cells: cells,
        baseMine: baseMine,
        baseChest: baseChest,
        needTotal: r.total - baseMine - baseChest,
        color: r.color
      });
    }
    return out;
  }

  function componentsOf(cells, constraints) {
    var parent = {};
    var i;
    for (i = 0; i < cells.length; i++) { parent[cells[i]] = cells[i]; }

    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) { parent[rb] = ra; }
    }

    for (i = 0; i < constraints.length; i++) {
      var cs = constraints[i].cells;
      for (var k = 1; k < cs.length; k++) { union(cs[0], cs[k]); }
    }

    var groups = {};
    for (i = 0; i < cells.length; i++) {
      var root = find(cells[i]);
      if (!groups[root]) { groups[root] = []; }
      groups[root].push(cells[i]);
    }

    var consByRoot = {};
    for (i = 0; i < constraints.length; i++) {
      var r = find(constraints[i].cells[0]);
      if (!consByRoot[r]) { consByRoot[r] = []; }
      consByRoot[r].push(constraints[i]);
    }

    var out = [];
    for (var key in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, key)) { continue; }
      out.push({ cells: groups[key], constraints: consByRoot[key] || [] });
    }
    return out;
  }

  function enumerateComponent(component, poss, budget, maxComponent) {
    var cells = component.cells;
    var k = cells.length;
    if (k === 0 || k > (maxComponent || MAX_COMPONENT)) { return null; }

    var pos = {};
    var i;
    for (i = 0; i < k; i++) { pos[cells[i]] = i; }

    var cons = [];
    for (i = 0; i < component.constraints.length; i++) {
      var src = component.constraints[i];
      var mapped = [];
      var ok = true;
      for (var m = 0; m < src.cells.length; m++) {
        var p = pos[src.cells[m]];
        if (p === undefined) { ok = false; break; }
        mapped.push(p);
      }
      if (!ok) { continue; }
      cons.push({
        pos: mapped,
        needTotal: src.needTotal,
        color: src.color,
        baseMine: src.baseMine,
        baseChest: src.baseChest,
        mine: 0,
        chest: 0,
        assigned: 0
      });
    }

    var cellCons = new Array(k);
    for (i = 0; i < k; i++) { cellCons[i] = []; }
    for (i = 0; i < cons.length; i++) {
      for (var p2 = 0; p2 < cons[i].pos.length; p2++) { cellCons[cons[i].pos[p2]].push(i); }
    }

    var val = new Array(k);
    var seen = new Array(k);
    for (i = 0; i < k; i++) { val[i] = 0; seen[i] = 0; }

    var nodes = 0;
    var aborted = false;
    var solutions = 0;

    function feasible(ci) {
      var c = cons[ci];
      var remaining = c.pos.length - c.assigned;
      if (c.mine + c.chest > c.needTotal) { return false; }
      if (c.mine + c.chest + remaining < c.needTotal) { return false; }
      if (c.needTotal < 0) { return false; }
      if (c.color === L.RED) {
        if (c.chest > 0) { return false; }
        if (c.mine + remaining < c.needTotal) { return false; }
      } else if (c.color === L.BLUE) {
        if (c.mine > 0) { return false; }
        if (c.chest + remaining < c.needTotal) { return false; }
      }
      return true;
    }

    function full(ci) {
      var c = cons[ci];
      if (c.mine + c.chest !== c.needTotal) { return false; }
      if (c.color === L.RED && c.chest !== 0) { return false; }
      if (c.color === L.BLUE && c.mine !== 0) { return false; }
      if (c.color === L.MIXED) {
        if (c.baseMine + c.mine < 1) { return false; }
        if (c.baseChest + c.chest < 1) { return false; }
      }
      return true;
    }

    function assign(d, v) {
      val[d] = v;
      for (var q = 0; q < cellCons[d].length; q++) {
        var c = cons[cellCons[d][q]];
        c.assigned++;
        if (v === POSS_MINE) { c.mine++; }
        else if (v === POSS_CHEST) { c.chest++; }
      }
    }

    function unassign(d, v) {
      val[d] = 0;
      for (var q = 0; q < cellCons[d].length; q++) {
        var c = cons[cellCons[d][q]];
        c.assigned--;
        if (v === POSS_MINE) { c.mine--; }
        else if (v === POSS_CHEST) { c.chest--; }
      }
    }

    function dfs(d) {
      if (aborted) { return; }
      nodes++;
      if (nodes > budget) { aborted = true; return; }

      if (d === k) {
        for (var ci = 0; ci < cons.length; ci++) { if (!full(ci)) { return; } }
        solutions++;
        for (var s = 0; s < k; s++) { seen[s] |= val[s]; }
        return;
      }

      var pm = poss[cells[d]];
      var opts = [];
      if (pm & POSS_MINE) { opts.push(POSS_MINE); }
      if (pm & POSS_CHEST) { opts.push(POSS_CHEST); }
      if (pm & POSS_EMPTY) { opts.push(POSS_EMPTY); }

      for (var oi = 0; oi < opts.length; oi++) {
        var v = opts[oi];
        assign(d, v);
        var okay = true;
        for (var cj = 0; cj < cellCons[d].length; cj++) {
          if (!feasible(cellCons[d][cj])) { okay = false; break; }
        }
        if (okay) { dfs(d + 1); }
        unassign(d, v);
        if (aborted) { return; }
      }
    }

    dfs(0);

    if (aborted || solutions === 0) { return null; }
    return { cells: cells, seen: seen, solutions: solutions };
  }

  function enumerateDeduce(state, poss, budget, maxComponent) {
    var constraints = buildConstraints(state, poss);
    if (!constraints.length) { return { changed: false, capHits: 0, enumerated: 0 }; }

    var cellSet = {};
    var i;
    for (i = 0; i < constraints.length; i++) {
      for (var k = 0; k < constraints[i].cells.length; k++) {
        cellSet[constraints[i].cells[k]] = true;
      }
    }
    var cells = [];
    for (var key in cellSet) {
      if (Object.prototype.hasOwnProperty.call(cellSet, key)) { cells.push(Number(key)); }
    }

    var comps = componentsOf(cells, constraints);
    var changed = false;
    var capHits = 0;
    var enumerated = 0;

    for (i = 0; i < comps.length; i++) {
      var result = enumerateComponent(comps[i], poss, budget, maxComponent);
      if (!result) {
        capHits++;
        continue;
      }
      enumerated++;
      for (var d = 0; d < result.cells.length; d++) {
        var idx = result.cells[d];
        var s = result.seen[d];
        var next = 0;
        if (s & POSS_MINE) { next |= POSS_MINE; }
        if (s & POSS_CHEST) { next |= POSS_CHEST; }
        if (s & POSS_EMPTY) { next |= POSS_EMPTY; }
        if (next && next !== poss[idx]) { poss[idx] = next; changed = true; }
      }
    }

    return { changed: changed, capHits: capHits, enumerated: enumerated };
  }

  /* ---------- 选一步走 ---------- */

  function pickMove(state, poss, order) {
    var cols = state.cfg.cols;
    var rows = state.cfg.rows;
    var i;

    /* 1. 已经确定是货箱的，优先收 */
    for (i = 0; i < poss.length; i++) {
      if (state.open[i] !== L.HIDDEN) { continue; }
      if (poss[i] === POSS_CHEST) { return i; }
    }

    /*
     * 2. 确定不可能是暗礁的。
     * 默认挑「贴着最多已有读数」的那个（信息量最大）；
     * order='index' 时挑序号最小的，用来给可解率做一个走法敏感性对照。
     */
    var best = -1;
    var bestScore = -1;
    for (i = 0; i < poss.length; i++) {
      if (state.open[i] !== L.HIDDEN) { continue; }
      if (poss[i] & POSS_MINE) { continue; }

      if (order === 'index') { return i; }

      var nb = L.neighborsOf(cols, rows, i);
      var score = 0;
      for (var k = 0; k < nb.length; k++) {
        if (state.open[nb[k]] === L.OPEN_SAFE) { score++; }
      }
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  /* ---------- 主流程 ---------- */

  function hiddenCount(state) {
    var n = 0;
    for (var i = 0; i < state.open.length; i++) {
      if (state.open[i] === L.HIDDEN) { n++; }
    }
    return n;
  }

  /*
   * 严格模式的成功条件：**所有暗礁的位置都确定了**。
   * 推到不动点之后，凡是「能证明不是暗礁」的格子都被开掉了，
   * 所以还藏着的格子一定还带着「可能是暗礁」这一位。
   * 于是「暗礁全定」等价于：每个剩余隐藏格都是确定的暗礁（poss === POSS_MINE）。
   */
  function allMinesKnown(state, poss) {
    for (var i = 0; i < poss.length; i++) {
      if (state.open[i] !== L.HIDDEN) { continue; }
      if (poss[i] !== POSS_MINE) { return false; }
    }
    return true;
  }

  function finish(state, poss, solvable, reason, moves, capHits, enumRounds, mode) {
    var undetermined = [];
    for (var i = 0; i < poss.length; i++) {
      if (state.open[i] !== L.HIDDEN) { continue; }
      if (poss[i] !== POSS_MINE && poss[i] !== POSS_CHEST && poss[i] !== POSS_EMPTY) {
        undetermined.push({ idx: i, poss: poss[i] });
      }
    }
    return {
      solvable: !!solvable,
      mode: mode || 'door',
      reason: reason,
      collected: state.collected,
      moves: moves,
      capHits: capHits,
      enumRounds: enumRounds,
      oxygen: state.oxygen,
      hiddenLeft: hiddenCount(state),
      undetermined: undetermined,
      poss: poss
    };
  }

  /*
   * 两种模式：
   *   mode 'door' （默认）找到门就算成功
   *   mode 'strict'        必须把所有暗礁的位置都推出来才算成功
   */
  function solve(state, opts) {
    opts = opts || {};
    var budget = opts.budget || DEFAULT_BUDGET;
    var strict = opts.mode === 'strict';
    var mode = strict ? 'strict' : 'door';

    var moves = 0;
    var capHits = 0;
    var enumRounds = 0;
    var poss = makePoss(state);
    propagate(state, poss);

    for (var guard = 0; guard < 400; guard++) {
      /* 配额模式：捞满就收工。严格模式不看配额。 */
      if (!strict && (state.doorOpened || state.revealedAll)) {
        return finish(state, poss, true, 'door', moves, capHits, enumRounds, mode);
      }
      if (state.status !== L.PLAYING) {
        var okEnd = strict ? allMinesKnown(state, poss) : false;
        return finish(state, poss, okEnd, 'ended', moves, capHits, enumRounds, mode);
      }

      var move = pickMove(state, poss, opts.order);

      /* 给外部校验用的钩子：批量分析时会用它拿真实棋盘交叉验证，确认没有乱推 */
      if (opts.onStep) { opts.onStep(state, poss); }

      if (move < 0) {
        enumRounds++;
        var res2 = enumerateDeduce(state, poss, budget);
        capHits += res2.capHits;
        if (!res2.changed) {
          var verdict = strict ? allMinesKnown(state, poss) : false;
          return finish(state, poss, verdict, 'fixpoint', moves, capHits, enumRounds, mode);
        }
        move = pickMove(state, poss, opts.order);
        if (move < 0) {
          var verdict2 = strict ? allMinesKnown(state, poss) : false;
          return finish(state, poss, verdict2, 'fixpoint', moves, capHits, enumRounds, mode);
        }
      }

      var opened = L.openCell(state, move);
      for (var e = 0; e < opened.events.length; e++) {
        if (opened.events[e].type === 'mine') {
          throw new Error('求解器打开了暗礁 ' + move + '，推理有 bug');
        }
      }
      state = opened.state;
      moves++;

      /* 局面变了，重建知识再推一遍 */
      poss = makePoss(state);
      propagate(state, poss);
    }

    var verdict3 = strict ? allMinesKnown(state, poss) : false;
    return finish(state, poss, verdict3, 'guard', moves, capHits, enumRounds, mode);
  }

  return {
    solve: solve,
    makePoss: makePoss,
    propagate: propagate,
    enumerateDeduce: enumerateDeduce,
    pickMove: pickMove,
    POSS_MINE: POSS_MINE,
    POSS_CHEST: POSS_CHEST,
    POSS_EMPTY: POSS_EMPTY
  };
})();




