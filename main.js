/*
 * 深潜 · 串联层
 * 只做三件事：管一次下潜的进程、接点击、把结果交给渲染层。
 * 规则一点都不许写在这里。
 */
(function () {
  'use strict';

  var L = DeepDiveLogic;
  var G = DeepDiveGenerator;
  var U = DeepDiveUI;
  var H = DeepDiveHint;
  var R = DeepDiveRun;

  /* ---------- 全局异常兜底 ---------- */
  var fatalSeen = {};

  function reportFatal(msg, src, line, col) {
    var file = String(src || '').split('/').pop() || '?';
    var where = file + ':' + (line || '?') + (col ? ':' + col : '');
    var text = '[脚本错误] ' + where + '  ' + msg;
    if (fatalSeen[text]) { return; }       /* 同一条只弹一次，避免刷屏 */
    fatalSeen[text] = true;
    if (U && U.fatalBar) { U.fatalBar(text); }
    else if (window.console) { console.error(text); }
  }

  window.onerror = function (msg, src, line, col) {
    reportFatal(msg, src, line, col);
    return false;
  };

  window.addEventListener('unhandledrejection', function (ev) {
    var r = (ev && ev.reason) || {};
    reportFatal('Promise 未捕获: ' + (r.message || r), r.fileName || '', r.lineNumber || '', r.columnNumber || '');
  });

  window.__fatalInstalled = true;

  /* ?debug=1 才打 [DIVE] 日志；正常玩家完全静默 */
  var DIVE_DEBUG = /[?&]debug=1/.test(window.location.search || '');
  window.__DIVE_DEBUG = DIVE_DEBUG;
  if (DIVE_DEBUG) {
  window.__dive = {
    state: function () { return state; },
    run: function () { return run; },
    endNow: function () { settleLevel(); },
    diveNow: function () { if (state) { state.doorOpened = true; } onDive(); }
  };
  }
  function dlog(msg) { if (DIVE_DEBUG && window.console) { console.log('[DIVE] ' + msg); } }

  var GATE_MAX_ATTEMPTS = 200;

  var SAVE_RUN = 'dd.run';
  var SAVE_LEVEL = 'dd.level';
  var SAVE_MODE = 'dd.mode';    /* 模式总开关：true = 经典模式 */

  /* 玩家在这一关里亲手做过什么 —— 过关看这个，不看棋盘清没清空 */
  var practiceMode = false;   /* 练习局：提示和提示免费不限次 */
  var practiceDone = false;   /* 练习局的恭喜框只弹一次 */
  var APP_VERSION = '0.9.0';
  var SAVE_REC = 'dd.records';

  var state = null;
  var run = null;
  var records = R.emptyRecords();
  var tick = 0;
  var startedAt = 0;
  var phase = 'playing';
  /* 活跃时长：可见时计时，隐藏时把这一段累加进 run.activeMs */
  var activeSince = Date.now();
  function activeResume() { activeSince = Date.now(); }
  function activePause() {
    if (!run) { return; }
    run.activeMs = (run.activeMs || 0) + Math.max(0, Date.now() - activeSince);
    activeSince = Date.now();
    saveRun();
  }
  function activeTotal() {
    return (run && run.activeMs ? run.activeMs : 0) + Math.max(0, Date.now() - activeSince);
  }
  window.addEventListener('resize', function () {
    if (state && state.board) { try { U.render(state); } catch (e) {} }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { activePause(); } else { activeResume(); }
  });   /* 'playing' | 'cleared' | 'ended' */
  var hintCostWarned = false;

  /* ---------- 存档 ---------- */

  function loadJSON(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 无痕模式写不进去就算了 */ }
  }

  function dropKey(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* 同上 */ }
  }

  function saveRun() { saveJSON(SAVE_RUN, run); }

  /* ---------- 首页 ---------- */
  function hasResumableSave() {
    return !!(savedRun && savedRun.depth > 0 && savedRun.oxygen > 0);
  }

  function renderHome() {
    var layer = document.getElementById('home-layer');
    if (!layer) { return; }
    layer.hidden = false;

    var startBtn = document.getElementById('home-start');
    var restart = document.getElementById('home-restart');
    if (hasResumableSave()) {
      if (startBtn) { startBtn.textContent = '继续下潜（第 ' + (savedRun.depth || 1) + ' 层）'; }
      if (restart) { restart.hidden = false; }
    } else {
      if (startBtn) { startBtn.textContent = '开始下潜'; }
      if (restart) { restart.hidden = true; }
    }

    var rd = document.getElementById('home-rec-depth');
    var rt = document.getElementById('home-rec-total');
    var rc = document.getElementById('home-rec-clear');
    if (rd) { rd.textContent = '第 ' + (records.deepest || 0) + ' 层'; }
    if (rt) { rt.textContent = (records.total || 0) + ' 个氧气瓶'; }
    if (rc) { rc.textContent = (records.clearedCount || 0) + ' 次'; }
    var rt2 = document.getElementById('home-rec-time');
    if (rt2) { rt2.textContent = DeepDiveResult.fmtDur(records.totalMs || 0); }
  }

  function hideHome() {
    var layer = document.getElementById('home-layer');
    if (layer) { layer.hidden = true; }
  }

  function homeStart() {
    hideHome();
    if (hasResumableSave()) {
      run = savedRun || run;
      savedRun = run;
      var cap = 100 + Math.min(Math.max((run.depth || 1) - 1, 0), 50);
      if (run.oxygen > cap) { run.oxygen = cap; }
      startLevel();
    } else {
      newDive();
    }
  }

  function homeRestart() {
    if (window.confirm && !window.confirm('放弃当前进度，从第 1 层重来？')) { return; }
    hideHome();
    newDive();
  }

  function homeTutorial() {
    hideHome();
    startTutorial();
  }

  function showToast(title, sub, ms) {
    var layer = document.getElementById('home-layer');
    if (!layer) { return; }
    var el = document.getElementById('home-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'home-toast';
      el.className = 'home-toast';
      layer.appendChild(el);
    }
    el.textContent = sub ? (title + ' · ' + sub) : title;
    el.classList.add('show');
    window.clearTimeout(el._t);
    el._t = window.setTimeout(function () { el.classList.remove('show'); }, ms || 1800);
  }

  function homeSettings() { showToast('设置即将开放', '', 1600); }
  function homeFeedback() { showToast('反馈即将开放', '', 1600); }
  function homeAbout() {
    showToast('《深潜》 v' + APP_VERSION, '一片等你探索的未知海域', 2400);
  }

  /* 首页按钮：document 级委托（不依赖元素先存在） */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) { return; }
    var el = t.closest('[data-home-action]');
    if (!el) { return; }
    var act = el.getAttribute('data-home-action');
    dlog('[HOME] ' + act);
    if (act === 'start') { homeStart(); }
    else if (act === 'restart') { homeRestart(); }
    else if (act === 'tutorial') { homeTutorial(); }
    else if (act === 'settings') { homeSettings(); }
    else if (act === 'feedback') { homeFeedback(); }
    else if (act === 'about') { homeAbout(); }
    else if (act === 'mode') {
      /* 目前只有「经典模式」一项，做成不可展开；将来的挑战 / 深渊模式加在这里 */
      showToast('经典模式', '其它模式开发中', 1600);
    }
  });

  /* 结算展示：通关 / 失败共用一套行定义，真实流程和 ?win=1 / ?lose=1 都走这里 */
  function showResultWin() {
    DeepDiveResult.show({
      skin: 'win',
      perfect: (run.hits || 0) === 0,
      rows: [
        { k: '海底编号', v: '#' + String(run.seed || 0) },
        { k: '本次用时', v: DeepDiveResult.fmtDur(run.activeMs) },
        { k: '打捞氧气瓶', n: run.totalCollected || 0, unit: ' 个' },
        { k: '翻开格子', n: run.cellsOpened || 0, unit: ' 格' },
        { k: '撞击暗礁', n: run.hits || 0, unit: ' 次' },
        { k: '历史最快', v: records.bestMs ? DeepDiveResult.fmtDur(records.bestMs) : '—' },
        { k: '完成时间', v: DeepDiveResult.fmtDate(Date.now()) }
      ],
      primaryLabel: '保存这张图',
      onPrimary: function () {
        dlog('[RESULT] 保存海报');
        try {
          var cv = DeepDivePoster.buildPoster(run, records, 'win');
          DeepDivePoster.savePoster(cv, '深潜-海底编号' + String(run.seed || 0) + '-第' + (run.depth || 1) + '层.png');
        } catch (e) { dlog('[RESULT] 海报失败 ' + (e && e.message)); }
      },
      onHome: function () { window.location.reload(); }
    });
  }

  function showResultLose(depth) {
    run.activeMs = activeTotal();   /* 用时用真实活跃时长，别拿旧值 */
    var d = depth || run.depth;
    DeepDiveResult.show({
      skin: 'lose',
      depth: d,
      rows: [
        { k: '到达深度', v: '第 ' + d + ' 层' },
        { k: '本局用时', v: DeepDiveResult.fmtDur(run.activeMs) },
        { k: '打捞氧气瓶', n: run.totalCollected || 0, unit: ' 个' },
        { k: '翻开格子', n: run.cellsOpened || 0, unit: ' 格' },
        { k: '撞击暗礁', n: run.hits || 0, unit: ' 次' },
        { k: '历史最深', v: '第 ' + records.deepest + ' 层' },
        { k: '结束时间', v: DeepDiveResult.fmtDate(Date.now()) }
      ],
      primaryLabel: '重新下潜',
      onPrimary: function () { DeepDiveResult.hide(); newDive(); },
      onHome: function () { window.location.reload(); }
    });
  }

  /* 每层结束/下潜都打一行统计 */
  function statLine(mark) {
    if (!run) { return; }
    dlog('[STAT' + mark + '] 深度=' + run.depth + ' 翻开=' + (run.cellsOpened || 0) + ' 瓶=' + (run.bottles || 0)
      + ' 撞=' + (run.hits || 0) + ' 活跃=' + Math.round(activeTotal()) + 'ms');
  }

  /*
   * 棋盘进度也要存：关掉页面再回来，不能从这一关的第一格重新打。
   * 存的是完整局面（棋盘布局 + 已翻开 + 标记 + 裂纹 + 氧气），读回来逐格还原。
   */
  function saveLevel() {
    if (!state || !state.board) { return; }
    saveJSON(SAVE_LEVEL, {
      depth: run.depth,
      seed: state.seed,
      cfg: state.cfg,
      cells: state.board.cells,
      readings: state.readings,
      open: state.open,
      marks: state.marks,
      chestRare: state.chestRare,
      oxygen: state.oxygen,
      collected: state.collected,
      sunk: state.sunk,
      moves: state.moves,
      cleared: state.cleared,
      door: state.door,
      doorOpened: !!state.doorOpened,
      perfect: state.perfect,
      status: state.status,
      firstMove: state.firstMove,
      firstCell: state.firstCell
    });
  }

  function restoreLevel(saved) {
    if (!saved || !saved.cells) { return null; }
    var st = {
      cfg: saved.cfg,
      seed: saved.seed,
      board: { cols: saved.cfg.cols, rows: saved.cfg.rows, cells: saved.cells },
      readings: saved.readings,
      open: saved.open,
      marks: saved.marks,
      chestRare: saved.chestRare,
      oxygen: saved.oxygen,
      collected: saved.collected,
      sunk: saved.sunk,
      moves: saved.moves,
      cleared: saved.cleared,
      perfect: saved.perfect,
      status: saved.status,
      firstMove: saved.firstMove,
      firstCell: saved.firstCell,
      door: (typeof saved.door === 'number' && saved.door >= 0) ? saved.door : -1,
      doorOpened: !!saved.doorOpened
    };

    /* 旧存档没有 door：用和 materialize 完全相同的公式现算一个 */
    if (!(st.door >= 0)) {
      st.door = L.doorFor(st);
      if (window.__DIVE_DEBUG) { console.log('[DIVE] restore 补算门 = ' + st.door); }
    }

    /* 不变量：门必须是 CHEST，且下标合法 */
    var ok = st.door >= 0 && st.board.cells[st.door] === L.CHEST;
    if (!ok) {
      st.door = L.doorFor(st);
      if (window.__DIVE_DEBUG) {
        console.log('[DIVE] restore 门不变量失败，已重算 = ' + st.door +
          ' 类型=' + st.board.cells[st.door]);
      }
    }
    return st;
  }
  function saveRecords() { saveJSON(SAVE_REC, records); }

  /* ---------- 种子 ---------- */

  function seedFromUrl() {
    var m = /[?&]seed=(\d+)/.exec(window.location.search || '');
    return m ? (parseInt(m[1], 10) >>> 0) : null;
  }

  function nextSeed() {
    tick += 1;
    var fixed = seedFromUrl();
    if (fixed != null && tick === 1) { return fixed; }
    return ((Date.now() >>> 0) + tick * 7919) >>> 0;
  }



  /* ---------- 一次下潜 ---------- */

  /* 开一层。氧气从本次下潜里带上来的，不重置。 */
  var lastCapShown = 0;
  var clearBannerShown = false;

  function startLevel() {
    dlog('[RESTART] startLevel 进入 depth=' + (run && run.depth) + ' run.oxygen=' + (run && run.oxygen));
    clearBannerShown = false;
    dlog('startLevel 入口 depth=' + run.depth +
      ' 旧seed=' + (state && state.seed != null ? state.seed : null) +
      ' 新seed=' + run.seed +
      ' board=' + (state && state.board ? '有' : 'null'));
    /* 有同一关的进度就直接接上，不再重铺 */
    var savedLevel = loadJSON(SAVE_LEVEL);
    if (savedLevel && savedLevel.depth === run.depth && savedLevel.cells) {
      dlog('[RESTART] startLevel 走 restore 分支（有本层存档）');
      state = restoreLevel(savedLevel);
        dlog('startLevel 分支: restore depth=' + savedLevel.depth);
      phase = 'playing';
      startedAt = 0;
      U.stopAnim();
      U.hideOverlay();
      U.clearHint();
      
      U.setDepth(run.depth);
      U.setHintLeft(run.hintsLeft);
      U.render(state);
      var restoredMods = DeepDiveModifiers.short(run.mods);
      U.setMods(restoredMods);
      document.getElementById('seed').textContent = '海底编号 #' + state.seed;
      return;
    }

    var seed = nextSeed();

    /* 先定修饰符，再按「基准 + 累积修饰符」铺盘（闸门在 createGame 之后才跑，修饰符不变） */
    run = R.drawModsIfNeeded(run);
    saveRun();

    var cfg = R.configFor(run.depth, run.oxygen, run.seed, run.mods);
    state = L.createGame({ seed: seed, config: cfg });
    dlog('[RESTART] createGame 之后 state.oxygen=' + state.oxygen + ' depth=' + run.depth);

    /* 本层的修饰符必须让玩家看见 —— 否则「怎么炸了 11 格」没法解释 */
    var modList = DeepDiveModifiers.short(run.mods);
    U.setMods(modList);

    /* 难度提示已全部移除（用户要求） */
    U.setPressure(cfg.pressureName, !!cfg.shape);
    startedAt = 0;
    phase = 'playing';
    U.stopAnim();
    U.hideOverlay();
    U.clearHint();
    
    U.setDepth(run.depth);
    U.setHintLeft(run.hintsLeft);
    U.render(state);
    if (run.depth >= 100) { U.showBanner('第 100 层', '撞上一次礁，就结束了', 2500, 'final'); }
    /* 氧气上限 +1：本层与上一层都用同一公式现算，差值永远是 1（51 层封顶后不弹） */
    if (run.depth > 1) {
      var capNow = cfg.oxygenCap;
      var capPrev = 100 + Math.min(Math.max(run.depth - 2, 0), 50);
      if (capNow > capPrev) {
        U.showBanner('氧气上限 +' + (capNow - capPrev), '深潜让肺活量更大了', 1800, 'cap');
      }
    }
    document.getElementById('seed').textContent = '海底编号 #' + seed;
    saveRun();
  }

  function newDive() {
    dlog('[RESTART] newDive 入口 旧run.oxygen=' + (run && run.oxygen));
    practiceMode = false;
    practiceDone = false;
    U.setPractice(false);
    /* 重开必须先把中途存档扔掉 —— 否则 startLevel 会把它读回来，看起来就是「重开没反应」 */
    dropKey(SAVE_LEVEL);
    run = R.create(nextSeed());
    dlog('[RESTART] R.create 之后 run.oxygen=' + run.oxygen);
    run.startedAt = Date.now();
    run.activeMs = 0;
    run.cellsOpened = 0;
    run.bottles = 0;
    run.hits = 0;
    activeSince = Date.now();
    hintCostWarned = false;
    saveRun();
    document.getElementById('seed').textContent = '';
    startLevel();
  }

  /* 一层怎么收尾：清场就下一层，氧气耗尽就结束本次下潜 */
  function settleLevel() {
    var res = R.settle(run, state);
    run = res.run;
    statLine('✕');
    saveRun();

    dropKey(SAVE_LEVEL);

    if (res.finished) {
      phase = 'ended';
      var best = R.isNewRecord(records, run);
      records = R.updateRecords(records, run);
      records.totalMs = (records.totalMs || 0) + Math.round(activeTotal());
      saveRecords();
      dropKey(SAVE_RUN);
      run.activeMs = activeTotal();
      /* 旧行已由 statLine 取代 */
      dlog('[STAT-old] 深度=' + run.depth + ' 翻开=' + run.cellsOpened + ' 瓶=' + run.bottles + ' 撞=' + run.hits + ' 活跃=' + Math.round(run.activeMs) + 'ms');
      DeepDiveResult.show({
        skin: 'lose',
        depth: run.depth,
        rows: [
          { k: '到达深度', v: '第 ' + run.depth + ' 层' },
          { k: '本局用时', v: DeepDiveResult.fmtDur(run.activeMs) },
          { k: '打捞氧气瓶', n: run.totalCollected || 0, unit: ' 个' },
          { k: '翻开格子', n: run.cellsOpened || 0, unit: ' 格' },
          { k: '撞击暗礁', n: run.hits || 0, unit: ' 次' },
          { k: '历史最深', v: '第 ' + records.deepest + ' 层' },
          { k: '结束时间', v: DeepDiveResult.fmtDate(Date.now()) }
        ],
        primaryLabel: '重新下潜',
        onPrimary: function () { DeepDiveResult.hide(); newDive(); },
        onHome: function () { window.location.reload(); }
      });
      return;
    }

    /*
     * 清场不弹任何东西、也不自动进层：
     * 清场必然蕴含「门已开」，出口对话框在开门那一刻已经弹过了（每层只弹一次）。
     * 玩家想走就自己点漩涡。
     */
    /*
     * 注意：不把 phase 改成 cleared —— onOpen 第一行会 if (phase !== 'playing') return，
     * 改了之后玩家就点不动漩涡了。
     */
    phase = 'playing';
    if (!clearBannerShown) {
      clearBannerShown = true;
      U.showBanner('这层搜完了', '点漩涡，往更深处走', 2000, 'cleared');
    }
  }

  /* ---------- 交互 ---------- */

  /*
   * 首点：这里是唯一会跑闸门的地方。
   * 棋盘本来就是首点时才铺的，所以「铺盘 → 验证 → 不可解重掷」都在这一刻完成。
   */
  function gateFirstMove(idx) {
    var shape = state.cfg.shape || null;
    var cols = state.cfg.cols, rows = state.cfg.rows;
    /*
     * 形态 + 闸门合成一个循环：生成 → 算指标 → 命中形态 → 过严格闸门。
     * 不命中就直接换下一张（generator 内部按 attemptSeed 换 seed）。
     */
    var accept = shape
      ? function (st) { return DeepDiveShape.hit(shape, DeepDiveShape.metrics(st), cols, rows); }
      : null;
    var gated = G.ensureSolvable(state, idx, { maxAttempts: GATE_MAX_ATTEMPTS, accept: accept });
    state = gated.state;
    document.getElementById('seed').textContent = '海底编号 #' + state.seed;
    return gated;
  }


  /* ---------- 教学关（v1：框架 + 第 1–3 屏） ---------- */
  var TUT_MODE = false;
  var TUT_IDX = 0;
  var TUT_SNAP = null;
  var TUT_STEP = 0;
  var TUT_READY_AT = 0;
  var TUT_BACKUP_RUN = null;
  var TUT_BACKUP_RECORDS = null;
  var TUT_BACKUP_STATE = null;
  var TUT_DOOR_CLOSED = false;
  var TUT_DONE_KEY = 'dd.tutorialDone';   /* 走完最后一屏才写；跳过不写 */
  var TUT_WAIT_TAP = false;  /* 色盲提示后等待一次点击 */

  function tutScreen() { return DeepDiveTutorial.screenAt(TUT_IDX); }

  /* 教学高亮：每次 render 之后重贴（render 会重建格子） */
  function tutMarkTarget() {
    var all = document.querySelectorAll('.cell.tut-target');
    for (var i = 0; i < all.length; i++) { all[i].classList.remove('tut-target'); }
    var s0 = tutScreen();
    if (!s0 || s0.highlight < 0) { return; }
    var cell = document.querySelector('.cell[data-idx="' + s0.highlight + '"]');
    if (cell && cell.classList) { cell.classList.add('tut-target'); }
  }

  function tutEnter() {
    var s = tutScreen();
    if (!s) { return; }
    if (s.mission === 'door-manual') {
      /* 第一拍：只把漩涡放出来，不弹框 */
      state.open[s.door] = DeepDiveTutorial.OPEN_CHEST;
      state.door = s.door;
      state.doorOpened = true;
      state.collected += 1;
      TUT_STEP = 0;
      TUT_WAIT_TAP = false;
      U.render(state);
      setContinue();
      return;
    }
  }

  /* TUTPAINT */
  function tutPaint() {
    var s = tutScreen();
    TUT_READY_AT = Date.now() + 300;   /* 进屏后 300ms 内忽略点击 */
    dlog('[TUT] 进入第 ' + (TUT_IDX + 1) + ' 屏 id=' + (s && s.id) + ' cfg=' + (state && state.cfg ? (state.cfg.cols + 'x' + state.cfg.rows) : '-') + ' board=' + (state && state.board ? '有' : 'null'));
    /* 每次进屏先清掉上一屏的 HUD 高亮（第 7/8/9 屏不许残留） */
    if (document.body) { document.body.classList.remove('tut-hud'); }
    var hudHi = document.querySelectorAll('.tut-hud-hi');
    for (var hi = 0; hi < hudHi.length; hi++) { hudHi[hi].classList.remove('tut-hud-hi'); }
    var hintBtn0 = document.getElementById('hint-btn');
    if (hintBtn0) { hintBtn0.classList.remove('tut-hud-hi-btn'); }
    if (!s) { return; }
    $val('tut-step', (TUT_IDX + 1) + ' / ' + DeepDiveTutorial.COUNT);
    $val('tut-text', s.text || '');
    $val('tut-sub', s.sub || '');
    if (s.hint) { setHint(s.hint, !!s.hintYellow); }
    else if (s.kind === 'tap') { setContinue(); }
    else { setHint(''); }
    var hEl0 = document.getElementById('tut-hint');
    if (hEl0) {
      var htxt = hEl0.textContent || '';
      var isContinue = htxt.indexOf('继续') >= 0 || htxt.indexOf('点任意处') >= 0;
      hEl0.className = 'tut-hint' + ((s.hintYellow || isContinue) ? ' warn' : '');
    }
    var overlay = document.getElementById('tut-layer');
    if (overlay) { overlay.hidden = false; }
    try { U.render(state); } catch (e) { $val('tut-hint', '渲染出错: ' + (e && e.message)); }
    tutMarkTarget();
    /* 高亮可点的格子 */
    var cell = state && s.highlight >= 0 ? document.querySelector('.cell[data-idx="' + s.highlight + '"]') : null;
    if (cell && cell.classList) { cell.classList.add('tut-target'); }

    /* 第 6 屏：高亮当前子步指向的 HUD 元素 */
    if (s.mission === 'door-reward') {
      /* 关框后的文案与高亮由 tutOpen 处理；这里只保持显示，不推进 */
      return;
    }
    if (s.mission === 'finale') { return; }
    if (s.mission === 'hud-steps') {
      if (document.body) { document.body.classList.toggle('tut-hud', !!(s.steps[TUT_STEP] && s.steps[TUT_STEP].fab)); }
      var st = s.steps[TUT_STEP];
      $val('tut-text', st ? st.text : s.text);
      $val('tut-sub', (st && st.sub) ? st.sub : '');
      setContinue();
      if (st) {
        var el2 = document.querySelector(st.target);
        if (el2 && el2.classList) { el2.classList.add('tut-hud-hi'); }
      }

    }
  }

  /* 第三行提示：文字 + 颜色一次设定，杜绝「只改文字不改颜色」 */
  function setHint(text, yellow) {
    var el = document.getElementById('tut-hint');
    if (!el) { return; }
    el.textContent = text || '';
    el.className = 'tut-hint' + (yellow ? ' warn' : '');
    el.style.color = yellow ? '#ffd86b' : '';
    el.style.fontWeight = yellow ? '700' : '';
  }
  function setContinue() { setHint('点任意处继续', true); }

  function $val(id, v) {
    var el = document.getElementById(id);
    if (el) { el.textContent = v; }
  }

  function startTutorial() {
    try { startTutorialInner(); } catch (e) { window.__TUTERR = String(e && e.message || e); var el = document.getElementById('tut-hint'); if (el) { el.textContent = 'ERR ' + window.__TUTERR; } }
  }
  function startTutorialInner() {
    /* 进入教学前备份正式进度；不改动 run / records 本身 */
    TUT_BACKUP_RUN = run;
    TUT_BACKUP_STATE = state;
    TUT_BACKUP_RECORDS = JSON.parse(JSON.stringify(records));
    dlog('[TUT] 备份时 board=' + (state && state.board ? '有' : 'null') + ' seed=' + (state && state.seed));
    if (U.setDepth) { U.setDepth(1); }   /* 教学里显示第 1 层 */
    TUT_MODE = true;
    if (document.body) { document.body.classList.add('tut-on'); }
    /* 文字条要跟着棋盘走：把它挪进 .app 的流里 */
    var app = document.querySelector('.app');
    var layer = document.getElementById('tut-layer');
    if (app && layer && layer.parentNode !== app) { app.appendChild(layer); }
    TUT_IDX = 0;
    TUT_SNAP = null;
    phase = 'playing';
    U.hideOverlay();
    var mm = R.configFor(1, 100, 1, null).mineCost;
    state = DeepDiveTutorial.buildState(TUT_IDX, { mineCost: mm });
    tutPaint();
    tutEnter();
  }

  /* 「开始下潜」：丢弃教学备份，清存档，从第 1 层新开一局 */
  function finishTutorialToNewDive() {
    TUT_MODE = false;
    TUT_BACKUP_RUN = null;
    TUT_BACKUP_STATE = null;
    TUT_BACKUP_RECORDS = null;
    if (document.body) { document.body.classList.remove('tut-on'); document.body.classList.remove('tut-hud'); }
    var layer = document.getElementById('tut-layer');
    if (layer) { layer.hidden = true; }
    var box = document.getElementById('tut-final');
    if (box) { box.hidden = true; }
    U.hideOverlay();
    newDive();
  }

  function endTutorial() {
    dlog('[TUT] endTutorial 进入');
    TUT_MODE = false;
    dlog('[TUT] TUT_MODE 已关');
    if (document.body) { document.body.classList.remove('tut-on'); document.body.classList.remove('tut-hud'); }
    var overlay = document.getElementById('tut-layer');
    if (overlay) { overlay.hidden = true; }
    dlog('[TUT] layer 已隐藏');
    U.hideOverlay();
    dlog('[TUT] 即将调 newDive');
    if (TUT_BACKUP_RUN) {
      run = TUT_BACKUP_RUN;
      state = TUT_BACKUP_STATE;
      records = TUT_BACKUP_RECORDS;
      TUT_BACKUP_RUN = null;
      TUT_BACKUP_STATE = null;
      TUT_BACKUP_RECORDS = null;
      if (U.setDepth) { U.setDepth(run.depth); }
      if (state && state.board) { try { U.render(state); } catch (err) {} }
      dlog("[TUT] 已恢复正式进度 depth=" + run.depth);
      renderHome();
    } else {
      newDive();
    }
    dlog('[TUT] newDive 返回了');
  }

  function tutAdvance() {
    dlog('[TUT] 推进 ' + (tutScreen() ? tutScreen().id : '?') + ' → ' + ((DeepDiveTutorial.screenAt(TUT_IDX + 1) || {}).id || 'END'));
    TUT_IDX++;
    TUT_STEP = 0;
    TUT_WAIT_TAP = false;
    TUT_SNAP = null;
    if (TUT_IDX >= DeepDiveTutorial.COUNT) {
      /* 8 屏走完 → 弹结尾框；真正的结束在「开始下潜」按钮 */
      TUT_IDX = DeepDiveTutorial.COUNT - 1;
      var layerFin = document.getElementById('tut-layer');
      if (layerFin) { layerFin.hidden = true; }
      var boxFin = document.getElementById('tut-final');
      if (boxFin) { boxFin.hidden = false; }
      return;
    }
    state = DeepDiveTutorial.buildState(TUT_IDX, { mineCost: state.cfg.mineCost });
    tutPaint();
    tutEnter();
  }

  /* 第 3 屏：演示撞礁 → 1 秒后完整回滚 */
  function tutDemo(idx, hintText, demoText) {
    var s = tutScreen();
    TUT_SNAP = { open: state.open.slice(), oxygen: state.oxygen, marks: state.marks.slice() };
    state = {
      seed: state.seed, cfg: state.cfg, board: state.board, readings: state.readings,
      open: state.open.slice(), marks: state.marks.slice(), chestRare: state.chestRare,
      oxygen: Math.max(1, state.oxygen - ((state.cfg && state.cfg.mineCost) || 25)),
      collected: state.collected, sunk: state.sunk + 1, moves: state.moves + 1,
      cleared: false, perfect: false, status: state.status, firstMove: false,
      firstCell: -1, door: -1, doorOpened: false, practice: false
    };
    state.open[idx] = DeepDiveTutorial.OPEN_MINE;
    U.render(state);
    /* 第 2 拍：第一行不动，第三行黄色说明扣氧 */
    var hDemo = document.getElementById('tut-hint');
    if (hDemo) { hDemo.textContent = hintText || '点击暗礁，氧气会扣减。'; hDemo.className = 'tut-hint warn'; }
    window.setTimeout(function () {
      if (!TUT_MODE || !TUT_SNAP) { return; }
      state.open = TUT_SNAP.open.slice();
      state.marks = TUT_SNAP.marks.slice();
      state.oxygen = TUT_SNAP.oxygen;
      TUT_SNAP = null;
      U.render(state);
      tutMarkTarget();
      /* 第 3 拍：恢复原状后换第一行，第三行先清空 */
      if (demoText) { $val('tut-text', demoText); }   /* 空字符串 = 保持进屏那句 */
      $val('tut-sub', '');
      $val('tut-hint', '');
      var hEl = document.getElementById('tut-hint');
      if (hEl) { hEl.className = 'tut-hint'; }
      /* 第 4 拍：接着黄色显示操作指令 */
      window.setTimeout(function () {
        if (!TUT_MODE) { return; }
        var h2 = document.getElementById('tut-hint');
        if (h2) { h2.textContent = '长按这一格，将它标记为暗礁。'; h2.className = 'tut-hint warn'; }
      }, 500);
    }, 1800);
  }

  /* 教学里的一次点击 */
  /* TUTOPEN */
  function tutOpen(idx) {
    /* DOORMANUAL */
    var _sdm = tutScreen();
    if (_sdm && _sdm.mission === 'door-manual') {
      var dlgM = document.getElementById('confirm-dive');
      /* 弹框已经打开：任意点击 = 关框并进下一屏 */
      if (dlgM && !dlgM.hidden) {
        dlgM.hidden = true;
        dlog('[TUT] 第7屏 关框 → 进下一屏');
        TUT_WAIT_TAP = false;
        tutAdvance();
        return;
      }
      if (TUT_STEP === 0) {
        TUT_STEP = 1;
        $val('tut-text', '找到它之后，你可以选择继续探索，也可以下潜。');
        $val('tut-sub', '');
        setContinue();
        return;
      }
      if (TUT_STEP === 1) {
        TUT_STEP = 2;
        $val('tut-text', _sdm.swirlBeatText || '点击漩涡进入下一关。');
        $val('tut-sub', '');
        setHint('请点击漩涡。', true);
        return;
      }
      /* 第三拍：点漩涡才弹框 */
      if (idx === _sdm.door) {
        dlog('[TUT] 第7屏 点漩涡 → 弹「已找到出口」');
        TUT_WAIT_TAP = true;
        openExitDialog();
      }
      return;
    }
    /* /DOORMANUAL */
    /* DOORREWARD */
    var _sd = tutScreen();
    if (_sd && _sd.mission === 'door-reward') {
      var dlg0 = document.getElementById('confirm-dive');
      if (dlg0) { dlg0.hidden = true; }
      TUT_WAIT_TAP = false;
      $val('tut-text', '漩涡开了之后，这层剩下的氧气瓶价值翻倍。');
      $val('tut-sub', '但不是任何时候都值得继续挖——你自己掂量。');
      setContinue();
      var bs0 = document.getElementById('bottle-sub');
      if (bs0) { bs0.textContent = '奖励 ×2'; bs0.className = 'k2 shown'; }
      TUT_DOOR_CLOSED = true;
      return;
    }
    /* /DOORREWARD */
    /* CLEARCELL */
    var _s0 = tutScreen();
    if (_s0 && _s0.mission === 'clear-cell' && idx === _s0.clearIdx) {
      var before = state.open[idx];
      var r9 = L.openCell(state, idx);
      var evs = (r9 && r9.events) ? r9.events.map(function (e) { return e.type; }).join(',') : 'none';
      dlog('[TUT] S9 点格 idx=' + idx + ' 之前open=' + before + ' events=' + evs);
      if (r9 && r9.state) { state = r9.state; }
      U.render(state);
      var cleared9 = [];
      for (var q = 0; q < state.open.length; q++) {
        if (state.open[q] !== DeepDiveTutorial.HIDDEN && state.board.cells[q] !== DeepDiveTutorial.MINE) { cleared9.push(q); }
      }
      U.paintAutoClear(cleared9);
      U.playSonar(cleared9, state.cfg.cols);
      $val('tut-text', '这就是清场。清场也不等于过关——下潜永远只有一种方式：点漩涡。');
      $val('tut-sub', '');
      setContinue();
      setHint('这就是清场，剩下的格子被免费翻开了。', true);
      window.setTimeout(tutAdvance, 2500);
      return;
    }
    /* /CLEARCELL */
    if (Date.now() < TUT_READY_AT) { return; }
    var s = tutScreen();
    if (!s) { return; }
    if (s.kind === 'tap') { tutAdvance(); return; }
    if (s.mission === 'open') {
      if (idx !== 12) { return; }
      state.open[idx] = DeepDiveTutorial.OPEN_SAFE;
      state.oxygen = Math.max(1, state.oxygen - state.cfg.stepCost);
      U.render(state);
      tutAdvance();
      return;
    }
    if (s.mission === 'hud-steps') {
      TUT_STEP++;
      if (TUT_STEP >= s.steps.length) { tutAdvance(); return; }
      tutPaint();
      return;
    }
    if (s.mission === 'collect-bottles') {
      if (s.allow.indexOf(idx) < 0) { return; }
      if (state.open[idx] !== DeepDiveTutorial.HIDDEN) { return; }
      var isChest = state.board.cells[idx] === DeepDiveTutorial.CHEST;
      state.open[idx] = isChest ? DeepDiveTutorial.OPEN_CHEST : DeepDiveTutorial.OPEN_SAFE;
      if (isChest) {
        state.oxygen += s.chestOxy;
        state.collected += 1;
        $val('tut-hint', '氧气增加');
      } else {
        state.oxygen = Math.max(1, state.oxygen - state.cfg.stepCost);
      }
      U.render(state);
      if (state.collected >= s.needBottles) { window.setTimeout(tutAdvance, 700); }
      return;
    }
    if (s.mission === 'solve-purple') {
      if (TUT_WAIT_TAP) { tutAdvance(); return; }
      if (s.allow.indexOf(idx) < 0) { return; }
      if (state.open[idx] !== DeepDiveTutorial.HIDDEN) { return; }
      if (state.board.cells[idx] !== DeepDiveTutorial.CHEST) { return; }   /* 雷只能标记 */
      state.open[idx] = DeepDiveTutorial.OPEN_CHEST;
      state.oxygen += s.chestOxy;
      state.collected += 1;
      U.render(state);
      $val('tut-hint', '氧气增加');
      tutCheckPurple();
      return;
    }
    if (s.mission === 'demo-then-mark') {
      if (idx !== s.demoIdx) { return; }
      if (TUT_SNAP) { return; }        /* 演示中不接受点击 */
      tutDemo(idx, s.markHint || s.demoHint, s.demoText);
      return;
    }
  }

  function tutCheckPurple() {
    var s = tutScreen();
    if (!s || s.mission !== 'solve-purple') { return; }
    var minesMarked = 0;
    for (var i = 0; i < state.marks.length; i++) { if (state.marks[i]) { minesMarked++; } }
    if (state.collected >= s.needBottles && minesMarked >= s.needMines) {
      TUT_WAIT_TAP = true;
      $val('tut-text', '分不清三种颜色的话，可以记住数字右上角的小标记：');
      $val('tut-text', '分不清三种颜色的话，可以记住数字右上角的小标记：');
      $val('tut-sub', '红色右上角是三角形，蓝色右上角是圆点，紫色右上角是短横');
      setContinue();
      /* 指向棋盘上的红/蓝/紫三个数字 */
      [2, 14, 20].forEach(function (ci) {
        var el = document.querySelector('.cell[data-idx="' + ci + '"]');
        if (el) { el.classList.add('tut-cb'); el.classList.add('tut-cb-' + (ci === 2 ? 'red' : (ci === 20 ? 'blue' : 'purple'))); }
      });
    }
  }

  /* 教学里的一次标记 */
  function tutMark(idx) {
    var s = tutScreen();
    if (!s) { return false; }
    if (s.mission === 'demo-then-mark' && idx === s.demoIdx) {
      state.marks[idx] = true;
      U.render(state);
      if (s.autoClearOnMark) {
        window.setTimeout(function () {
          if (!TUT_MODE) { return; }
          var ac = L.autoClearCheck(state);
          if (ac && ac.triggered) { state = ac.state; }
          U.render(state);
          if (ac && ac.revealed && ac.revealed.length) {
            U.paintAutoClear(ac.revealed);
            U.playSonar(ac.revealed, state.cfg.cols);   /* 正式游戏同一套动效 */
          }
          var hEl = document.getElementById('tut-hint');
          if (hEl) { hEl.textContent = '看，剩下的格子免费翻开了。'; hEl.className = 'tut-hint warn'; }
        }, 500);
      }
      window.setTimeout(tutAdvance, 1200);   /* 标记动画 500ms + 停顿 700ms */
      return true;
    }
    if (s.mission === 'solve-purple') {
      if (s.allow.indexOf(idx) < 0) { return true; }
      if (state.open[idx] !== DeepDiveTutorial.HIDDEN) { return true; }
      state.marks[idx] = !state.marks[idx];
      U.render(state);
      tutCheckPurple();
      return true;
    }
    return false;
  }

  function onOpen(idx, opts) {
    dlog('[TUT] 点击 idx=' + idx + ' 教学模式=' + TUT_MODE);
    if (TUT_MODE) { tutOpen(idx); return; }
    if (phase !== 'playing') { return; }
    /* 提示替你点的那一下保留高亮；玩家自己点才清掉上一组 */
    if (!(opts && opts.keepHint)) { U.clearHint(); }


    /* 闸门会重新 createGame，把练习标记丢掉 —— 先记下来，闸门之后补回去 */
    var wasPractice = state.practice === true;

    if (state.firstMove) {
      try {
        gateFirstMove(idx);
      } catch (err) {
        var bundle = (err && err.detail) ? err.detail : { code: (err && err.code) || 'UNKNOWN', message: String(err && err.message || err) };
        try {
          if (window.console && console.error) {
            console.error('[GATE-FAIL]', JSON.stringify(bundle, null, 2));
            console.error('[GATE-FAIL] 完整对象：', bundle);
          }
        } catch (e2) { /* console 都不可用就算了 */ }
        U.showFatal(
          (bundle.cfg ? ('seed ' + bundle.seed + ' · ' + bundle.cfg.cols + '×' + bundle.cfg.rows +
            ' · 礁 ' + bundle.cfg.mines + ' · 瓶 ' + bundle.cfg.chests + ' · ' + bundle.lastReason) : '') ||
          (err && err.message ? err.message : String(err))
        );
        if (DIVE_DEBUG) { window.__ddLastGateFail = bundle; }
        return;
      }
      startedAt = Date.now();
    }

    /* A5：门已开时，再点那一格 = 点漩涡，弹确认框下潜 */
    if (state.doorOpened && idx === state.door) {
      openExitDialog();
      return;
    }

    var prevOpened = 0;
    for (var pi = 0; pi < state.open.length; pi++) { if (state.open[pi] !== L.HIDDEN) { prevOpened++; } }
    var res = L.openCell(state, idx, opts);
    if (res.events.length === 1 && res.events[0].type === 'noop') { return; }

    state = res.state;
    if (wasPractice) { state.practice = true; }
    if (!wasPractice) { tryAutoClear(); }
    U.render(state);
    U.playEvents(res.events);

    /* A3：开到门那一刻 —— 横幅提示「剩余氧气瓶 ×2」 */
    /* ---- 统计：翻开格数 / 氧气瓶 / 撞礁 ---- */
    (function () {
      var opened = 0;
      for (var oi = 0; oi < state.open.length; oi++) {
        if (state.open[oi] !== L.HIDDEN) { opened++; }
      }
      if (opened > prevOpened) { run.cellsOpened = (run.cellsOpened || 0) + (opened - prevOpened); }
      prevOpened = opened;
      for (var ei = 0; ei < res.events.length; ei++) {
        var et = res.events[ei].type;
        if (et === 'mine') { run.hits = (run.hits || 0) + 1; }
        if (et === 'chest') { run.bottles = (run.bottles || 0) + 1; }
      }
    })();

    var doorEvents = 0;
    for (var dj = 0; dj < res.events.length; dj++) { if (res.events[dj].type === 'door') { doorEvents++; } }
    dlog('door 事件数=' + doorEvents + ' (events=' + res.events.length + ')');
    for (var di = 0; di < res.events.length; di++) {
      if (res.events[di].type === 'door') {
        openExitDialog();
        break;
      }
    }

    /* 氧气是跨层共用的，每一步都同步进本次下潜并存盘 */
    run.oxygen = state.oxygen;
    saveRun();
    saveLevel();

    /*
     * 练习局：走的是正常开格逻辑，通关判定也在这里。
     * 用一次性标记，不用 `state === doneState` —— 那个守卫会被玩家「再多点一格」
     * 立刻作废，只要他一直点，恭喜框就永远不出来。
     */
    if (state.practice) {
      if (!practiceDone && state.doorOpened) {
        practiceDone = true;
        setTimeout(function () { newDive(); }, 900);
      }
      return;
    }

    /* 最后一格演完先停一下，让玩家看清「翻完了」，再弹结算 */
    if (state.status !== L.PLAYING) {
      var finished = state;
      setTimeout(function () {
        if (state === finished && phase === 'playing') { settleLevel(); }
      }, 1500);
    }
  }


  /*
   * 每次动作之后试一次「自动清场」。
   * 条件是标完所有雷（且没标错）+ 开完所有箱子；达成后剩下的格免费翻开。
   */
  function tryAutoClear() {
    if (phase !== 'playing') { return false; }
    var res = L.autoClearCheck(state);
    if (!res.triggered) { return false; }
    state = res.state;
    U.paintAutoClear(res.revealed);
    U.playSonar(res.revealed, state.cfg.cols);
    /* 横幅错开 550ms：先让波浪扫出去，再报「扫描完成」 */
    setTimeout(function () { U.showBanner('海底扫描完成', '暗礁已全部标记', 1500, 'clear'); }, 550);
    U.render(state);
    return true;
  }

  function onMark(idx) {
    if (TUT_MODE) { tutMark(idx); return; }
    if (phase !== 'playing') { return; }
    if (!state || !state.board) { return; }   /* 棋盘还没铺，标记无效 */
    var markWasPractice = state.practice === true;
    var res = L.toggleMark(state, idx);
    if (res.events.length === 1 && res.events[0].type === 'noop') { return; }

    state = res.state;
    if (markWasPractice) { state.practice = true; }

    /* 标记也可能是「最后一步」：标完最后一块雷 + 箱子已开完 → 自动清场 */
    if (!markWasPractice && tryAutoClear()) {
      run.oxygen = state.oxygen;
      saveRun();
      saveLevel();
      return;
    }

    U.render(state);
    U.playEvents(res.events);
    saveLevel();
  }

  /*
   * 提示 = 演一遍推导过程（DESIGN v9）。全程无文字。
   *   1 拍 → 来源闪 → 目标闪 → 执行
   *   2–4 拍 → 逐步演，每拍结论格保留成「已知」
   *   5 拍以上 → 只闪目标，直接执行
   */
  function onHint() {
    if (!state || state.status !== L.PLAYING || phase !== 'playing') { return; }
    if (!state.board) { U.toast('先点一格海床，再点提示'); return; }
    if (U.isAnimating()) { return; }

    /* 清上一次的高亮 —— 清在这里，而不是动画结束时 */
    U.clearHint();

    /* 先扣费再给提示：提示永远消耗固定氧气，不因"没算出来"而免费 */
    var cost = (state && state.practice) ? 0 : R.hintCost(run, state && state.cfg);
    var before = state.oxygen;
    if (cost > 0) {
      var paid = L.spendHint(state, cost);
      if (!paid) { return; }
      state = paid.state;
      U.render(state);
      U.playEvents(paid.events);
      run.oxygen = state.oxygen;
      saveRun();
    }
    dlog('[HINT] 点前=' + before + ' 点后=' + state.oxygen);
    if (state.status !== L.PLAYING) { settleLevel(); return; }

    var plan = H.findPlan(state);
    if (!plan) {
      U.toast('这个局面没有更简单的提示了');
      return;
    }

    /* 只高亮被打开的那一格：不再播"思考过程" */
    if (plan.conclusion === 'safe') { onOpen(plan.target, { free: true, keepHint: true }); }
    else if (!state.marks[plan.target]) { onMark(plan.target); }
    U.markReveal(plan.target);
  }

  /*
   * 提示（−6 点）：和提示不同，它**直接给答案**。
   * 优先提示求解器能证明安全的；证明不出来就随便提示 —— 这是它便宜不了的理由。
   */
  /* ---------- 试玩盘（?board=1..5，只给人工试玩用） ---------- */

  /*
   * 从 tools/pairgen.js 生成的固定盘加载一局。
   * 不参与肉鸽进度、不写存档，纯粹为了让人能上手看紫格密度。
   */
  function startDevBoard(id) {
    /* 两组盘：手工高紫（boards.js）+ 按指标挑出来的（boards-picked.js） */
    var list = (window.DEEP_DIVE_BOARDS || []).concat(window.DEEP_DIVE_BOARDS_PICKED || []);
    var b = null;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { b = list[i]; break; } }
    if (!b) { return false; }

    run = R.create(1234);
    practiceMode = false;
    phase = 'playing';

    var cfg = {
      cols: b.cols, rows: b.rows,
      mines: b.mines, chests: b.chests,
      oxygen: 100, stepCost: 2, mineCost: 10,
      chestOxy: 8, rareRatio: 0
    };
    state = L.createGame({ seed: 2026 + b.id, config: cfg, fixedBoard: b.cells });
    state.devBoard = true;

    U.setPractice(false);
    U.setDepthLabel('试玩 ' + b.id);
    U.setHintLeft(0);
    U.render(state);
    document.getElementById('seed').textContent =
      (b.label ? b.label + '　·　' : '') + '紫比例 ' + (b.purple * 100).toFixed(1) + '%　首点请点 E5';
    return true;
  }

  /* ---------- 模式总开关（v15） ---------- */

  /*
   * 切换模式必须先把当前下潜清干净 —— 两种模式的棋盘、修饰符、存档语义都不一样，
   * 混着会串档。所以先问一句，确认后 drop 掉 run 和关卡存档再重开。
   */
  function onToggleMode() {
    var toClassic = !DeepDiveMode.isClassic();
    var msg = toClassic
      ? '切换到经典模式？\n\n所有暗礁都是普通暗礁，不会有炸弹和修饰符。\n当前下潜会被清空。'
      : '切换到复杂模式？\n\n会重新出现炸弹、炸毁和每层的修饰符。\n当前下潜会被清空。';
    if (window.confirm && !window.confirm(msg)) { return; }

    DeepDiveMode.set(toClassic);
    saveJSON(SAVE_MODE, toClassic);
    dropKey(SAVE_RUN);
    dropKey(SAVE_LEVEL);
    U.setModeLabel(toClassic);
    newDive();
  }

  /* 达标后主动下潜：进下一层，氧气照常带入（没有清场奖励） */
  function onDive() {
    dlog('onDive 入口 phase=' + phase + ' status=' + (state && state.status) + ' doorOpened=' + (state && state.doorOpened) + ' depth=' + run.depth);
    /* 下潜条件是「找到门」，不是「棋盘没打完」——清场之后正是该下潜的时候 */
    if (!state || phase !== 'playing') { return; }
    if (!state.doorOpened) { return; }
    dropKey(SAVE_LEVEL);
    var wasLayer100 = (run.depth >= 100);
    run = R.dive(run, state);
    statLine('→');
    if (wasLayer100) {
      run.activeMs = activeTotal();
      records.clearedCount = (records.clearedCount || 0) + 1;
      if (!records.bestMs || run.activeMs < records.bestMs) {
        records.bestMs = run.activeMs;
        records.bestAt = Date.now();
      }
      saveRecords();
      dlog('[STAT] 通关！累计第 ' + records.clearedCount + ' 次，本次 ' + Math.round(run.activeMs)
        + 'ms，最快 ' + Math.round(records.bestMs) + 'ms');
      phase = 'ended';
      DeepDiveResult.show({
        skin: 'win',
        perfect: (run.hits || 0) === 0,
        rows: [
          { k: '海底编号', v: '#' + String(run.seed || 0) },
          { k: '本次用时', v: DeepDiveResult.fmtDur(run.activeMs) },
          { k: '打捞氧气瓶', n: run.totalCollected || 0, unit: ' 个' },
          { k: '翻开格子', n: run.cellsOpened || 0, unit: ' 格' },
          { k: '撞击暗礁', n: run.hits || 0, unit: ' 次' },
          { k: '历史最快', v: records.bestMs ? DeepDiveResult.fmtDur(records.bestMs) : '—' },
          { k: '完成时间', v: DeepDiveResult.fmtDate(Date.now()) }
        ],
        primaryLabel: '保存这张图',
        onPrimary: function () { dlog('[RESULT] 保存图片：本轮未实现'); },
        onHome: function () { window.location.reload(); }
      });
      return;
    }
    dlog('onDive 出口 run.depth=' + run.depth);
    saveRun();
    startLevel();
  }

  /*
   * 「提示」= 原来的提示 + 原来的提示，合并成一个动作：
   *   1. 先把推理链亮出来（相关格全部高亮，保持到玩家下一次点击）
   *   2. 再花 6 点提示
   * 没有「没有更简单的提示了」这种状态 —— 只要氧气够，永远能开。
   */
  /* 发现出口：开门瞬间就弹，之后点漩涡也弹同一个 */
  function openExitDialog() {
    var box = document.getElementById('confirm-dive');
    dlog('openExitDialog 被调用, box=' + (box ? '有' : 'null') + ' 页面里共 ' + document.querySelectorAll('#confirm-dive').length + ' 个');
    if (!box) { return; }
    box.hidden = false;
    dlog('confirm-dive 已设为可见, hidden=' + box.hidden + ' display=' + getComputedStyle(box).display);
  }

  /* 弹确认框：确认 → 下一层，取消 → 留在本层 */




  /* 真正扣费 + 提示（高亮由 onOpen 在下次点击时清掉） */


  /*
   * 按钮：浮层上的「继续 / 重新下潜」走当前阶段对应动作；
   * 底部的「重新下潜」永远开新的一次下潜。
   */
  function onRestart() {
    /* 局中重开 = 结束整个下潜、回到第 1 层。防误触，先问一次。 */
    if (window.confirm && !window.confirm('结束本次下潜，从第 1 层重新开始？')) { return; }
    newDive();
  }

  /* ---------- 启动 ---------- */

  records = loadJSON(SAVE_REC) || R.emptyRecords();

  /* 仅调试：?debug=1&win=1 / ?debug=1&lose=1 直通结算界面 */
  (function resultDeepLink() {
    if (!window.__DIVE_DEBUG) { return; }
    var q = new URLSearchParams(window.location.search || '');
    var want = q.get('win') === '1' ? 'win' : (q.get('lose') === '1' ? 'lose' : '');
    var depthParam = q.get('depth');
    if (depthParam !== null) {
      var dn = parseInt(depthParam, 10);
      if (!isNaN(dn)) {
        want = 'depth';
        dn = Math.max(1, Math.min(100, dn));
      }
    }
    if (!want) { return; }
    /* 只触发一次：立刻从 URL 去掉 win/lose/depth，刷新后就是正常开局 */
    try {
      q.delete('win'); q.delete('lose'); q.delete('depth');
      var qs = q.toString();
      history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    } catch (e) {}
    /* run 可能还没创建：等它出现再开结算 */
    (function waitRun(tries) {
      if (!run) {
        if (tries > 40) { return; }
        window.setTimeout(function () { waitRun(tries + 1); }, 100);
        return;
      }
      /* 只用于展示：临时改 depth，展示后立刻还原，避免污染存档 */
      if (want === 'depth') {
        hideHome();
        run.depth = dn;
        saveRun();
        startLevel();
        dlog('[DIVE] 调试直跳第 ' + run.depth + ' 层');
        return;
      }
      hideHome();
      var origDepth = run.depth;
      if (want === 'win') { run.depth = 100; showResultWin(); }
      else { run.depth = 37; showResultLose(37); }
      run.depth = origDepth;
    })(0);
  })();
  var savedRun = loadJSON(SAVE_RUN);



  /*
   * 确认框按钮：用 document 级事件委托。
   * main.js 在 #confirm-dive 之前执行，直接 getElementById 拿到的是 null —— 这就是
   * "按钮点不动"的根因。委托不依赖元素先存在。
   */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.id) { return; }
    if (t.id === 'confirm-yes') {
      var box = document.getElementById('confirm-dive');
      if (box) { box.hidden = true; }
      if (TUT_MODE) {                       /* 教学里「下潜」= 进下一屏 */
        dlog('[TUT] 教学里点「下潜」→ 进下一屏');
        TUT_WAIT_TAP = false;
        tutAdvance();
        return;
      }
      onDive();
    } else if (t.id === 'confirm-no') {
      var box2 = document.getElementById('confirm-dive');
      if (box2) { box2.hidden = true; }
      if (TUT_MODE) {                       /* 教学里「继续探索」= 进下一屏 */
        dlog('[TUT] 教学里点「继续探索」→ 进下一屏');
        TUT_WAIT_TAP = false;
        tutAdvance();
      }
    }
  });

  document.addEventListener('click', function (ev) {
    var t0 = ev.target;
    if (t0 && t0.closest && t0.closest('#tut-hint-fab')) { dlog('[TUT] 提示按钮被点击（教学里不实际开格）'); return; }
    if (t0 && t0.closest && t0.closest('#tut-final-home')) {
      dlog('[TUT] 结尾选「回到首页」');
      try {
        try { localStorage.setItem(TUT_DONE_KEY, '"done"'); } catch (e) {}
        var fh = document.getElementById('tut-final');
        if (fh) { fh.hidden = true; }
        endTutorial();
      } catch (err) { console.error('[TUT] final-home 出错', err); }
      return;
    }
    if (t0 && t0.closest && t0.closest('#tut-final-go')) {
      dlog('[TUT] final-go 被点击（委托）');
      try {
        try { localStorage.setItem(TUT_DONE_KEY, '"done"'); } catch (e) {}
        var fb = document.getElementById('tut-final');
        if (fb) { fb.hidden = true; }
        finishTutorialToNewDive();
      } catch (err) { console.error('[TUT] final-go 出错', err); }
      return;
    }
    var t = ev.target;
    if (!t) { return; }
    var el = (t.closest && t.closest('#tut-skip')) || (t.id === 'tut-skip' ? t : null);
    if (!el) { return; }
    dlog('[TUT] 跳过被点击');
    endTutorial();
  }, true);


  /*
   * 教学：点「任意处」也能推进（不只是格子）。
   * tap 屏 / 等待点击的屏（色盲提示、第 7 屏关框、第 8 屏子步）都走这里。
   */
  document.addEventListener('click', function (ev) {
    if (!TUT_MODE) { return; }
    if (Date.now() < TUT_READY_AT) { return; }
    var s2 = tutScreen();
    if (!s2) { return; }
    var t2 = ev.target;
    if (t2 && (t2.closest && t2.closest('.cell'))) { return; }   /* 格子交给 onOpen */
    if (s2.kind === 'tap' || s2.mission === 'door-manual' || TUT_WAIT_TAP || s2.mission === 'hud-steps' || s2.mission === 'clear-cell') {
      tutOpen(-1);
    }
  });

  if (window.__DIVE_DEBUG) {
    window.__posterTest = function (skin) {
    var cv = DeepDivePoster.buildPoster(run, records, skin || 'win');
    document.body.innerHTML = '';
    document.body.appendChild(cv);
    cv.style.width = '750px';
    cv.style.height = '1334px';
    return cv;
  };
  window.__tutStart = startTutorial;
  window.__tutExit = endTutorial;
  window.__tutJump = function (i) {
      TUT_IDX = i; TUT_STEP = 0; TUT_WAIT_TAP = false;
      var mm2 = R.configFor((run && run.depth) || 1, 100, 1, null).mineCost;
      state = DeepDiveTutorial.buildState(i, { mineCost: mm2 });
      tutPaint(); tutEnter();
    };
  }

  /* 返回首页：正常关（底部）/ 教学关（右上角） */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) { return; }
    if (t.closest('#home-btn')) {
      dlog('[HOME] 正常关返回首页');
      savedRun = run;
      renderHome();
      return;
    }
    if (t.closest('#tut-home')) {
      dlog('[TUT] 教学关返回首页');
      endTutorial();
    }
  });

  U.init({ onOpen: onOpen, onMark: onMark, onRestart: onRestart, onHint: onHint, onDive: onDive, onToggleMode: onToggleMode });

  /* 模式开关：默认经典（首发面向新玩家）；存过就按存的来 */
  DeepDiveMode.set(loadJSON(SAVE_MODE) !== false);
  U.setModeLabel(DeepDiveMode.isClassic());

  /* ?board=N 直接进试玩盘（人工看紫格用），不碰存档 */
  var boardParam = /[?&]board=(\d+)/.exec(window.location.search || '');
  if (boardParam && startDevBoard(parseInt(boardParam[1], 10))) {
    // 试玩盘：跳过存档恢复
  } else {
    if (savedRun && savedRun.depth > 0 && savedRun.oxygen > 0) {
      run = savedRun;
      var capNow = 100 + Math.min(Math.max((run.depth || 1) - 1, 0), 50);
      if (run.oxygen > capNow) { run.oxygen = capNow; }
    } else {
      run = R.create(nextSeed());
    }
    renderHome();
  }
})();


























































