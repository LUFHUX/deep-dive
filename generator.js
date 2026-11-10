/*
 * 深潜 · 棋盘生成闸门（生成 - 验证 - 重掷）
 *
 * 位置：夹在 logic.js 和 solver.js 之上、渲染层之下。
 *   logic.js    纯规则，不管可解性
 *   solver.js   判断一局能不能不猜就捞满配额
 *   generator.js 这里：拿 solver 验证，不可解就换一个 seed 重掷
 *
 * 为什么要放在「首点」而不是「开局」：
 *   棋盘的 3×3 排除区依赖首点位置，所以整块棋盘是首次点击时才铺的
 *   （v0.5.1 的延迟生成）。闸门因此也只能在首次点击那一刻跑：
 *   按真实首点铺盘 → 模拟这一下 → 交给 solver → 不过关就重掷。
 *
 * 判定标准（2026-11-02 总部决定，从配额口径提到严格口径）：
 *   **所有暗礁的位置都必须能推出来。**
 *   不是「能捞满配额」就行 —— 那只有 88.2%，会留下猜不出来的尾巴。
 *   严格口径下自然生成的可解率是 32.9%，所以平均要重掷约 3 次。
 *
 * 重掷的随机性来自 attemptSeed(seed, k)，k 是第几次尝试。
 * 所以 [seed, 首点] 唯一确定最终棋盘，?seed= 依然能复现。
 *
 * 防死循环：MAX_ATTEMPTS 次全失败就抛错，绝不静默卡住。
 * 单局严格可解率约 33%，200 次全败的概率约 1e-35 —— 这条兜底不该被触发，
 * 但如果真触发了，说明 solver 或生成逻辑坏了，必须响亮地失败。
 */
var DeepDiveGenerator = (function () {
  'use strict';

  var L = DeepDiveLogic;
  var Solver = DeepDiveSolver;

  var MAX_ATTEMPTS = 200;

  /*
   * 第 k 次尝试用的 seed。
   * 第 0 次就是原始 seed —— 这样 ?seed= 打头那一局仍然符合直觉。
   * 之后用 xorshift 混一下，保证确定性：同样的 (seed, 首点) 一定得到同样的结果。
   */
  function attemptSeed(base, k) {
    if (k === 0) { return (base >>> 0) || 1; }
    var s = (((base >>> 0) ^ ((k * 2654435761) >>> 0)) >>> 0) || 0x9E3779B9;
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s || 1;
  }

  /*
   * 按首点铺一块棋盘，并保证它**严格可解**（所有暗礁都能推出来）。
   *
   * 返回 { state, attempts }：
   *   state    棋盘已经铺好、还没翻开任何格子（调用方自己去 openCell 首点）
   *   attempts 用了几次（1 = 一次就过）
   *
   * 抛错：MAX_ATTEMPTS 次都没通过。
   */
  function ensureOnce(state, firstCell, opts) {
    opts = opts || {};
    var maxAttempts = opts.maxAttempts || MAX_ATTEMPTS;
    var cfg = state.cfg;
    var lastReason = '';

    for (var k = 0; k < maxAttempts; k++) {
      var candidate = L.createGame({
        seed: attemptSeed(state.seed, k),
        config: cfg,
        firstCell: firstCell
      });

      /* 首点之前不可能有标记或已翻开的格子，但保险起见照搬一遍 */
      candidate.open = state.open.slice();
      candidate.marks = state.marks.slice();
      candidate.firstMove = state.firstMove;

      /* 模拟一下首点，得到玩家真正面对的那个局面 */
      var opened = L.openCell(candidate, firstCell);
      if (opened.state.status !== L.PLAYING) { continue; }

      /* 形态过滤：先看这张盘是不是这一层要的形态，不是就直接换下一张（省一次求解） */
      if (opts.accept && !opts.accept(opened.state)) { lastReason = 'shape'; continue; }

      var result = Solver.solve(opened.state, { budget: opts.budget, mode: 'strict' });
      if (result.solvable) {
        return { state: candidate, attempts: k + 1, solverMoves: result.moves };
      }
      lastReason = result.reason || 'undetermined';
    }

    /*
     * 失败信息要把概率说清楚，而不是一律喊「不可能」。
     * 上限 200 时这串数字是 1e-35 量级；有人把上限调到 1 做测试时，
     * 67% 是正常数字，不该被描述成异常。
     */
    var failRate = 0.643;                   /* 单局不可满清率，取 PARAMS.md 实测的 64.3% */
    var pAllFail = Math.pow(failRate, maxAttempts);
    var probText = pAllFail < 0.001
      ? pAllFail.toExponential(1)
      : (pAllFail * 100).toFixed(1) + '%';

    var err = new Error(
      '连续 ' + maxAttempts + ' 次都没生成出满清可解的棋盘（最后原因：' + lastReason + '）。' +
      '自然生成下满清可解率约 36%，连败 ' + maxAttempts + ' 次的概率约 ' + probText + '。' +
      (maxAttempts >= 20 ? '这么小的概率几乎不可能自然发生，说明求解器或生成逻辑坏了。' : '')
    );
    err.code = 'GATE_EXHAUSTED';
    /* 结构化诊断包：谁调用谁能直接打出来 */
    err.detail = {
      code: 'GATE_EXHAUSTED',
      seed: state.seed,
      firstCell: firstCell,
      attempts: maxAttempts,
      lastReason: lastReason,
      cfg: {
        cols: cfg.cols, rows: cfg.rows,
        mines: cfg.mines, chests: cfg.chests,
        stepCost: cfg.stepCost, mineCost: cfg.mineCost,
        chestOxy: cfg.chestOxy, oxygenCap: cfg.oxygenCap,
        shape: cfg.shape || null,
        pressure: cfg.pressureName || null
      }
    };
    throw err;
  }

  /*
   * 逐步降密：先按配置的暗礁数重试，不行就 −1、−2、−3，每档都仍要过严格闸门。
   * 降的是密度，不是标准；玩家侧不提示。
   */
  function ensureSolvable(state, firstCell, opts) {
    opts = opts || {};
    var base = state.cfg;
    var debug = (typeof window !== 'undefined' && window.__DIVE_DEBUG);
    var lastErr = null;
    for (var drop = 0; drop <= 3; drop++) {
      var mines = Math.max(1, base.mines - drop);
      var cfg = base;
      if (mines !== base.mines) {
        cfg = {};
        for (var kk in base) { if (Object.prototype.hasOwnProperty.call(base, kk)) { cfg[kk] = base[kk]; } }
        cfg.mines = mines;
        if (debug) { console.log('[GATE] 降密 ' + base.mines + '→' + mines + ' 重试'); }
      }
      var probe = state;
      if (cfg !== base) {
        probe = {};
        for (var q in state) { if (Object.prototype.hasOwnProperty.call(state, q)) { probe[q] = state[q]; } }
        probe.cfg = cfg;
      }
      try { return ensureOnce(probe, firstCell, opts); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('GATE_EXHAUSTED');
  }

  return {
    ensureSolvable: ensureSolvable,
    ensureOnce: ensureOnce,
    attemptSeed: attemptSeed,
    MAX_ATTEMPTS: MAX_ATTEMPTS
  };
})();

