/*
 * 深潜 · 肉鸽最小层（DESIGN v10）
 *
 * 一次下潜 = 一串连续的海床。氧气跨局共用，层间不重置。
 *   第 n 层：暗礁 9 + n（第 1 层 10 块），货箱 8，配额 5
 *   全开清场：额外 +20 氧气
 *   氧气耗尽：本次下潜结束，保留纪录（最深深度、总打捞），可以重新下潜
 *
 * 这个文件只放规则，不碰 localStorage、不碰 DOM。
 */
var DeepDiveRun = (function () {
  'use strict';

  var START_OXYGEN = 100;   /* 一次下潜的起始氧气 */
  var CLEAR_BONUS = 20;     /* 全开清场的回氧 */
  /* 棋盘尺寸/暗礁/货箱/配额/每箱氧气全部来自 ladder.js，这里不再写死。 */
  var MINE_COST = 10;
  var STEP_COST = 2;
  var HINT_COST = 4;   /* 提示：教你怎么看 */
    var HINT_LIMIT = 3;   /* 每局提示次数（不消耗氧气） */

  /* 第 n 层用什么配置铺盘 */
  /*
   * 第 depth 层的配置。v19 起阶梯表按 (seed, depth) 生成，所以必须传 seed 进来 ——
   * 同一 seed 重跑，同一层的尺寸/暗礁/主压力完全一致。
   */
  function configFor(depth, oxygen, seed, mods) {
    seed = (seed >>> 0) || 1;
    var lv = DeepDiveLadder.levelFor(depth, seed);

    /* 步成本四档；补给 = 步成本 × 10 */
    var stepCost = depth <= 25 ? 1 : (depth <= 50 ? 2 : (depth <= 75 ? 3 : 4));

    var base = {
      cols: lv.cols,
      rows: lv.rows,
      mines: lv.mines,
      chests: lv.chests,
      chestOxy: stepCost * 10,
      /* 阶梯表只管尺寸/暗礁/箱/配额/补给；炸弹相关先给基准值再叠修饰符 */
    };
    if (mods) { DeepDiveModifiers.apply(base, mods); }
    if (typeof DeepDiveMode !== 'undefined') {
      DeepDiveMode.applyToConfig(base);
      /* 经典模式：炸弹相关强制归零，不依赖 applyToConfig 的实现 */
      if (DeepDiveMode.isClassic && DeepDiveMode.isClassic()) {
      }
    }
    /* 稀有箱 = 普通箱 × RARE_MULT（比例常量只在 logic 里定义一份） */
    base.chestRareOxy = Math.round(base.chestOxy * (typeof DeepDiveLogic !== 'undefined' ? DeepDiveLogic.RARE_MULT : 2.5));

    return {
      cols: base.cols,
      rows: base.rows,
      mines: base.mines,
      chests: base.chests,
      chestOxy: base.chestOxy,
      chestRareOxy: base.chestRareOxy,
      oxygen: oxygen,
      /* v22：肺活量随深度增长 —— 每层上限 = 100 + 深度 */
      oxygenCap: 100 + Math.min(Math.max(depth - 1, 0), 50),
      /* v29：步成本四档（上面已算好） */
      stepCost: stepCost,
      /* v29：伤害 = round(本层上限 ÷ N)，N 来自 ladder 的 hitDivisor；第 100 关写死 150 */
      mineCost: (function (d) {
        if (d >= 100) { return 150; }
        var cap = 100 + Math.min(Math.max(d - 1, 0), 50);
        var b = DeepDiveLadder.bandFor(d);
        var n = (b && b.hitDivisor) ? b.hitDivisor : 4;
        return Math.round(cap / n);
      })(depth),
      /* mineCost 由上面的深度公式决定，不再读 ladder */
      /* 这一层的主压力 / 形态，供生成环节用 */
      pressure: lv.pressure,
      pressureName: lv.pressureName,
      shape: lv.shape,
      levelSeed: seed
    };
  }

  function create(seed) {
    return {
      depth: 1,
      oxygen: START_OXYGEN,
      totalCollected: 0,
    startedAt: Date.now(),
    activeMs: 0,
    cellsOpened: 0,
    bottles: 0,
    hits: 0,
      hintsLeft: HINT_LIMIT,
      seed: (seed >>> 0) || 1,
      mods: DeepDiveModifiers.emptyStacks(),
      modsDrawn: 0          /* 已经抽到第几关；存档回来不会重复抽 */
    };
  }

  /*
   * 一层结束。结果二选一：
   *   'cleared' —— 棋盘全开，回氧 +20，深度 +1，继续潜
   *   'ended'   —— 氧气耗尽，本次下潜结束
   */
  /*
   * 达标后主动下潜：进下一层、氧气照常带入。
   * 和 settle 的区别 —— 没有清场奖励（那是把整层捞干净的奖励），也不要求 perfect。
   */
  function dive(run, level) {
    var collected = level.collected || 0;
    var left = typeof level.oxygen === 'number' ? level.oxygen : run.oxygen;
    /* 拷贝 + 覆盖：新字段自动保留，别手写字段列表 */
    return Object.assign({}, run, {
      depth: run.depth + 1,
      oxygen: left,
      totalCollected: run.totalCollected + collected,
      hintsLeft: typeof run.hintsLeft === 'number' ? run.hintsLeft : HINT_LIMIT
    });
  }

  function settle(run, level) {
    var collected = level.collected || 0;
    /* 氧气以「这一层打完之后剩的」为准 —— run 上的值只是进这层时的起始值 */
    var left = typeof level.oxygen === 'number' ? level.oxygen : run.oxygen;

    /* 拷贝 + 覆盖：新字段自动保留 */
    var next = Object.assign({}, run, {
      oxygen: left,
      totalCollected: run.totalCollected + collected,
      hintsLeft: typeof run.hintsLeft === 'number' ? run.hintsLeft : HINT_LIMIT
    });

    if (level.perfect) {
      next.depth = run.depth + 1;
      var capNext = 100 + Math.min(Math.max(run.depth, 0), 50);
      next.oxygen = Math.min(capNext, left + CLEAR_BONUS);   /* 清场回氧也不许超过上限 */
      return { run: next, finished: false, collected: collected };
    }

    return { run: next, finished: true, collected: collected };
  }

  /*
   * 提示的费用（v11）：每大局前 3 次免费，之后每次 5。
   * 计数在 run 上，不随层重置 —— 换层不会白送你三次。
   */

  /*
   * 进关前把本关的修饰符抽出来（可复现：run.seed + depth）。
   * 同一关只抽一次 —— 存档读回来不会重复叠加。
   */
  function drawModsIfNeeded(run) {
    /*
     * 一律用「拷贝 + 覆盖」，不手写字段列表：
     * 手写的话以后任何新字段（统计、时间戳…）都会在这里被丢掉。
     */
    if (typeof DeepDiveMode !== 'undefined' && DeepDiveMode.isClassic()) {
      return Object.assign({}, run, {
        mods: DeepDiveModifiers.emptyStacks(),
        modsDrawn: run.depth,
        added: []
      });
    }
    if (run.modsDrawn >= run.depth) { return run; }
    var res = DeepDiveModifiers.draw(run.seed, run.depth, run.mods || DeepDiveModifiers.emptyStacks());
    return Object.assign({}, run, {
      mods: res.stacks,
      modsDrawn: run.depth,
      added: res.added || []
    });
  }

  /* 纪录：最深到过第几层、总共捞了多少 */
  function emptyRecords() {
    return { deepest: 0, total: 0, clearedCount: 0, bestMs: 0, bestAt: 0, totalMs: 0 };
  }

  function updateRecords(records, run) {
    return {
      deepest: Math.max(records.deepest || 0, run.depth),
      total: Math.max(records.total || 0, run.totalCollected)
    };
  }

  function isNewRecord(records, run) {
    return run.depth > (records.deepest || 0) || run.totalCollected > (records.total || 0);
  }

  return {
    START_OXYGEN: START_OXYGEN,
    CLEAR_BONUS: CLEAR_BONUS,
    MINE_COST: MINE_COST,
    STEP_COST: STEP_COST,
    HINT_COST: HINT_COST,
    HINT_LIMIT: HINT_LIMIT,
    dive: dive,
    drawModsIfNeeded: drawModsIfNeeded,
    configFor: configFor,
    create: create,
    settle: settle,
    emptyRecords: emptyRecords,
    updateRecords: updateRecords,
    isNewRecord: isNewRecord
  };
})();
















