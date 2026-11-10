/*
 * 深潜 · 教学关（v1：框架 + 第 1–3 屏）
 * 依据 TUTORIAL.md。棋盘全部手写，不走生成器、不走闸门。
 *
 * 一屏 = 一个场景：
 *   kind: 'tap' —— 点任意处进入下一屏
 *   kind: 'act' —— 必须完成指定动作才进入下一屏
 */
(function (global) {
  'use strict';

  var EMPTY = 0, MINE = 1, CHEST = 2;
  var HIDDEN = 0, OPEN_SAFE = 1, OPEN_MINE = 2, OPEN_CHEST = 3;

  /* 计算每个格子的读数（和 logic 同规则：8 邻域里的暗礁数） */
  function readingsFor(cols, rows, cells) {
    /* 直接复用逻辑层的实现：结构永远和真实棋盘一致（{mine,chest,total,color}） */
    return DeepDiveLogic.computeReadings({ cols: cols, rows: rows, cells: cells });
  }

  function blankOpen(n, v) {
    var a = [];
    for (var i = 0; i < n; i++) { a.push(v); }
    return a;
  }

  /*
   * 每屏定义：
   *   cols/rows/cells —— 手写棋盘
   *   open            —— 初始哪些格子已打开（其余一律 HIDDEN，且不可点）
   *   allow           —— 允许玩家点的格子
   *   highlight       —— 需要高亮的格子
   */
  var SCREENS = [
    {
      id: 'open-cell',
      kind: 'act',
      text: '点一下高亮的格子。',
      sub: '上方那条是氧气，作用稍后解释。',
      hint: '',
      hintYellow: false,
      cols: 5, rows: 5,
      /* 除了中心，其它全是已打开的空地 —— 只有一格可点 */
      cells: (function () {
        var c = [];
        for (var i = 0; i < 25; i++) { c.push(EMPTY); }
        c[12] = EMPTY;
        return c;
      })(),
      open: (function () {
        var o = [];
        for (var i = 0; i < 25; i++) { o.push(i === 12 ? HIDDEN : OPEN_SAFE); }
        return o;
      })(),
      allow: [12],
      highlight: 12,
      oxygen: 20,
      mission: 'open'
    },
    {
      id: 'red-one',
      kind: 'tap',
      text: '红色数字 1：它周围的 8 个格子中，有 1 个是暗礁，其余 7 格都是安全的，没有其他特殊物。',
      sub: '',
      cols: 5, rows: 5,
      cells: (function () {
        var c = [];
        for (var i = 0; i < 25; i++) { c.push(EMPTY); }
        c[6] = MINE;          /* 左上角那颗雷，让中心的 1 成立 */
        return c;
      })(),
      open: (function () {
        var o = [];
        for (var i = 0; i < 25; i++) { o.push(HIDDEN); }   /* 周围全部未打开 */
        o[12] = OPEN_SAFE;                                 /* 只有中心是开着的红 1 */
        return o;
      })(),
      allow: [],
      highlight: -1,
      oxygen: 20,
      mission: 'tap'
    },
    {
      id: 'deduce-and-mark',
      kind: 'act',
      text: '现在红色数字 1 周围的七个格子都打开了，都不是暗礁，所以剩下没打开的这格肯定是暗礁。',
      sub: '',
      cols: 5, rows: 5,
      cells: (function () {
        var c = [];
        for (var i = 0; i < 25; i++) { c.push(EMPTY); }
        c[6] = MINE;
        return c;
      })(),
      open: (function () {
        var o = [];
        for (var i = 0; i < 25; i++) { o.push(HIDDEN); }   /* 其余都没开 */
        o[12] = OPEN_SAFE;                                  /* 中心红 1 */
        /* 7 个邻居打开，只留 6（左上角那颗雷）没开 */
        [7, 8, 11, 13, 16, 17, 18].forEach(function (i) { o[i] = OPEN_SAFE; });
        return o;
      })(),
      allow: [6],
      highlight: 6,
      oxygen: 20,
      demoText: '看，点击暗礁，氧气会减少。',
      mission: 'demo-then-mark',
      demoIdx: 6
    },

    /* ---------- 第 4 屏：蓝 2（氧气瓶，真实加氧） ---------- */
    {
      id: 'blue-two',
      kind: 'act',
      text: '蓝色数字 2：它周围的 8 个格子中，有 2 个是氧气瓶，其余 6 格都是安全的，没有其他特殊物。',
      sub: '把两个氧气瓶都找出来吧。',
      hint: '拾取氧气瓶可增加氧气。',
      cols: 5, rows: 5,
      cells: (function () {
        var c = []; for (var i = 0; i < 25; i++) { c.push(EMPTY); }
        c[6] = CHEST; c[18] = CHEST;        /* 左上、右下两个瓶子 */
        return c;
      })(),
      open: (function () {
        var o = []; for (var i = 0; i < 25; i++) { o.push(OPEN_SAFE); }
        [6, 7, 8, 11, 13, 16, 17, 18].forEach(function (i) { o[i] = HIDDEN; });
        return o;
      })(),
      allow: [6, 7, 8, 11, 13, 16, 17, 18],
      highlight: -1,
      oxygen: 20,
      chestOxy: 8,
      mission: 'collect-bottles',
      needBottles: 2
    },

    /*
     * ---------- 第 5 屏：紫 3 + 红 2 + 蓝 1 ----------
     *
     * 6×6，三个特殊物：8、9、15；其余格子全部已打开。
     *
     *   紫 3 @14：(r2c2) 的邻居含 8、9、15 → 3 个特殊物，礁和瓶都有
     *   红 2 @2 ：(r0c2) 的邻居含 8、9，不含 15 → 恰好 2 个暗礁，且红周围没有瓶
     *   蓝 1 @20：(r3c2) 的邻居含 15，不含 8、9 → 恰好 1 个瓶，且蓝周围没有礁
     *
     * 推理链（逐步可验）：
     *   ① 红 2 只"看得见" 8 和 9 两个特殊物，而它要求恰好 2 个暗礁
     *      → 8、9 都是暗礁。
     *   ② 紫 3 说 3 个特殊物里礁和瓶都有；已知 8、9 是礁，只剩 15
     *      → 15 必定是氧气瓶。
     *   ③ 蓝 1 只看得见 15，要求恰好 1 个瓶 → 与 ② 一致（交叉验证，不引入新信息）。
     *
     * 唯一性已用 tools/tutorial5.js 暴力枚举验证：3 个特殊物 2³ 种赋值里只有
     * 「8=礁 9=礁 15=瓶」满足三条约束。
     */
    {
      id: 'purple-three',
      kind: 'act',
      text: '紫色数字 3：它周围的 8 个格子中，有 3 格是特殊物，且一定有暗礁和氧气瓶。',
      sub: '根据其他线索，尝试推一推：哪些格子是氧气瓶，哪些格子是暗礁。',
      hint: '氧气瓶直接打开，暗礁长按标记。',
      cols: 6, rows: 6,
      cells: (function () {
        var c = []; for (var i = 0; i < 36; i++) { c.push(EMPTY); }
        c[8] = MINE; c[9] = MINE; c[15] = CHEST;
        return c;
      })(),
      open: (function () {
        var o = []; for (var i = 0; i < 36; i++) { o.push(OPEN_SAFE); }
        [8, 9, 15].forEach(function (i) { o[i] = HIDDEN; });
        return o;
      })(),
      allow: [8, 9, 15],
      highlight: -1,
      oxygen: 20,
      chestOxy: 8,
      mission: 'solve-purple',
      needBottles: 1,
      needMines: 2,
      /* 让 14 号格显示成紫色 3（游戏里紫色 = 混合读数） */
      forceColor: { 14: 'mixed' }
    },

    /* ---------- 第 6 屏：认识界面（4 个子步） ---------- */
    {
      id: 'hud-tour',
      kind: 'act',
      text: '这是氧气条，氧气耗尽则本局游戏结束。每点开一格消耗氧气，越深消耗越多；撞上暗礁会掉一大截。',
      sub: '推理遇到困难时，可点击提示打开一格，每次消耗氧气。',
      cols: 5, rows: 5,
      cells: (function () { var c = []; for (var i = 0; i < 25; i++) { c.push(EMPTY); } return c; })(),
      open: (function () { var o = []; for (var i = 0; i < 25; i++) { o.push(OPEN_SAFE); } o[12] = OPEN_SAFE; return o; })(),
      allow: [],
      highlight: -1,
      oxygen: 40,
      mission: 'hud-steps',
      steps: [
        { target: '.stat.depth', text: '这是潜水深度。打通 100 层，就能登顶。' },
        { target: '.stat.oxy', text: '这是氧气条，氧气耗尽则本局游戏结束。每点开一格消耗氧气，越深消耗越多；撞上暗礁会掉一大截。' },
        { target: '#tut-hint-fab', text: '这是提示。推理遇到困难时，点它可以打开一格，每次消耗氧气。', fab: true },
        { target: '#stat-mines-box', text: '这是未探明暗礁：斜杠前面是还没被点开的暗礁数，后面是本层暗礁总数。它有时能帮你推理。' },
        { target: '.stat.bottles', text: '这是未开启氧气瓶：这一层还剩几个氧气瓶没找到。' }
      ]
    },

    /* ---------- 第 7 屏：漩涡与奖励 ---------- */
    {
      id: 'door-swirl',
      kind: 'act',
      text: '蓝色数字周围除了氧气瓶，还可能是漩涡。',
      sub: '漩涡是进入下一层的通道，开局随机藏在某个氧气瓶上。',
      cols: 6, rows: 6,
      cells: (function () {
        var c = []; for (var i = 0; i < 36; i++) { c.push(EMPTY); }
        c[15] = CHEST;                    /* 门就绑在这个瓶子上 */
        c[6] = MINE; c[16] = MINE;        /* 两颗远处暗礁，让海床合法 */
        return c;
      })(),
      open: (function () {
        var o = []; for (var i = 0; i < 36; i++) { o.push(OPEN_SAFE); }
        o[15] = HIDDEN;                   /* 进屏时自动打开它 */
        o[6] = HIDDEN; o[16] = HIDDEN;
        return o;
      })(),
      allow: [],
      highlight: -1,
      oxygen: 20,
      mission: 'door-manual',
      door: 15,
      swirlBeatText: '点击漩涡进入下一关。'
    },


    /* ---------- 第 8 屏：两种加速（两个子步） ---------- */
    {
      id: 'autoclear-mark',
      /* 结构完全照第 3 屏（demo-then-mark），只改三处：
         ① 不自动演示，等玩家点；② 点错多一句黄字；③ 标记成功后自动清场 */
      kind: 'act',
      text: '把最后这颗暗礁标出来试试。',
      sub: '长按那颗暗礁。',
      cols: 5, rows: 5,
      cells: (function () {
        var c = []; for (var i = 0; i < 25; i++) { c.push(EMPTY); }
        c[6] = MINE;
        return c;
      })(),
      open: (function () {
        var o = []; for (var i = 0; i < 25; i++) { o.push(OPEN_SAFE); }
        o[6] = HIDDEN; o[12] = HIDDEN; o[18] = HIDDEN; o[24] = HIDDEN;
        return o;
      })(),
      allow: [6],
      highlight: 6,
      oxygen: 20,
      mission: 'demo-then-mark',
      demoIdx: 6,
      markIdx: 6,
      noAutoDemo: true,
      markHint: '请长按标记暗礁',
      autoClearOnMark: true
    },

    {
      id: 'clear-demo',
      kind: 'act',
      text: '这格肯定安全，点开它。',
      sub: '',
      cols: 5, rows: 5,
      cells: (function () {
        var c = []; for (var i = 0; i < 25; i++) { c.push(EMPTY); }
        c[0] = MINE;                       /* 远处那颗，点不到，只为海床合法 */
        return c;
      })(),
      open: (function () {
        var o = []; for (var i = 0; i < 25; i++) { o.push(OPEN_SAFE); }
        o[12] = HIDDEN;                    /* 玩家要点的那格 */
        o[6] = HIDDEN; o[18] = HIDDEN; o[24] = HIDDEN;   /* 清场时才翻开的安全格 */
        return o;
      })(),
      allow: [12],
      highlight: 12,
      oxygen: 20,
      mission: 'clear-cell',
      clearIdx: 12
    },

    /* ---------- 第 9 屏：结尾 ---------- */

  ];

  function buildState(i, cfgDefaults) {
    var s = SCREENS[i];
    var cfg = {
      cols: s.cols, rows: s.rows,
      mines: 1, chests: 0,
      stepCost: (s.mission === 'hud-steps') ? 1 : 2,   /* 认识界面那屏按第 1 层算（提示 −6） */
      mineCost: (cfgDefaults && cfgDefaults.mineCost) || 75,
      chestOxy: 0,
      oxygenCap: 999,
      markCost: 0
    };
    return {
      seed: 1000 + i,
      cfg: cfg,
      board: { cols: s.cols, rows: s.rows, cells: s.cells.slice() },
      readings: readingsFor(s.cols, s.rows, s.cells),
      open: s.open.slice(),
      marks: blankOpen(s.cells.length, false),
      chestRare: blankOpen(s.cells.length, false),
      oxygen: s.oxygen,
      collected: 0,
      sunk: 0,
      moves: 0,
      cleared: false,
      perfect: true,
      status: (typeof DeepDiveLogic !== 'undefined') ? DeepDiveLogic.PLAYING : 'playing',
      firstMove: false,
      firstCell: -1,
      door: -1,
      doorOpened: false,
      practice: false,
      forceColor: s.forceColor || null
    };
  }

  global.DeepDiveTutorial = {
    COUNT: SCREENS.length,
    screenAt: function (i) { return SCREENS[i] || null; },
    buildState: buildState,
    EMPTY: EMPTY, MINE: MINE, CHEST: CHEST,
    HIDDEN: HIDDEN, OPEN_SAFE: OPEN_SAFE, OPEN_MINE: OPEN_MINE, OPEN_CHEST: OPEN_CHEST
  };
})(window);
