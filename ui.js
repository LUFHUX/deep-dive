/*
 * 深潜 · 渲染层
 *
 * 硬约定：本文件只管「把状态画出来」和「把输入转成 idx + 意图」。
 * 不含任何游戏规则 —— 规则全在 logic.js。
 * 移植微信小游戏时，整个文件丢掉重写，logic.js 原样搬走。
 */
var DeepDiveUI = (function () {
  'use strict';

  var L = DeepDiveLogic;

  var LONG_PRESS_MS = 500;
  var MOVE_TOLERANCE = 10;

  var boardEl = null;
  var cellEls = [];
  var handlers = {};

  /* 当前这组提示高亮。存成状态，paint 每次重画都按它重新贴 —— 否则会被整串赋值覆盖 */
  var hl = { source: {}, known: {}, reveal: {} };

  /* 「这里可以放标记」暗示：存在状态里，重画也不会丢 */
  var markHint = { idx: -1, strong: false };

  var pressTimer = null;
  var pressOrigin = null;
  var suppressClick = false;
  /* 标记去重：长按计时器与 contextmenu 都会触发，谁先到谁生效，另一个 700ms 内忽略 */
  var markFiredAt = 0;

  function $(id) { return document.getElementById(id); }

  function fireMark(idx) {
    if (Date.now() - markFiredAt < 700) { return; }   /* 另一个入口刚处理过 */
    markFiredAt = Date.now();
    if (handlers.onMark) { handlers.onMark(idx); }
  }

  /* ---------- 建棋盘 ---------- */

  var lastRenderedSeed = null;

  function buildBoard(state) {
    var cfg = state.cfg;
    boardEl.innerHTML = '';
    /* 行和列都要显式 minmax(0,1fr)：
     *  - 只写列的话，行是隐式 auto 行，会被数字撑高，翻开前后格子尺寸和行高就变了
     *  - 用 1fr 而不是 minmax(0,1fr) 的话，min 仍是 auto=min-content，照样会被撑开
     * （v0.5.1 规则第 8 条） */
    boardEl.style.gridTemplateColumns = 'repeat(' + cfg.cols + ', minmax(0, 1fr))';
    boardEl.style.gridTemplateRows = 'repeat(' + cfg.rows + ', minmax(0, 1fr))';
    /* 格子必须等大且正方形（DESIGN 规则 8） */
    fitBoard(boardEl, cfg.cols, cfg.rows);

    cellEls = [];
    for (var r = 0; r < cfg.rows; r++) {

      for (var cc = 0; cc < cfg.cols; cc++) {
        var i = r * cfg.cols + cc;
        var root = document.createElement('div');
        root.className = 'cell';
        root.setAttribute('data-idx', String(i));

        var n = document.createElement('span');
        n.className = 'n';
        root.appendChild(n);

        boardEl.appendChild(root);
        cellEls.push({ root: root, n: n });
      }
    }
    lastRenderedSeed = state.seed;
  }

  /* ---------- 画一帧 ---------- */

  /*
   * 裂纹：被炸弹波及但**没有被翻开**的格子。
   * 只加一层视觉，不显示读数、不显示内容 —— 玩家只知道「这里被炸过」。
   */
  /* 窄屏（<=430px）把四个标签压成单字，保证一行放得下 */
  /* HUD 标签：桌面和手机同一套短词（三个方块 + 氧气条） */
  /* HUD 标签：全文，桌面/手机同一套（与教学口径一致） */
  function applyHudLabels() {
    var dl = $('depth-label'), ml = $('mine-label'), bl = $('bottle-label'), ol = $('oxy-label');
    if (dl) { dl.textContent = '深度'; }
    if (ml) { ml.textContent = '未探明暗礁'; }
    if (bl) { bl.textContent = '未开启氧气瓶'; }
    if (ol) { ol.textContent = '氧气'; }
  }

  /* 按容器实际可用空间算尺寸：宽高都写死，grid 的 1fr 才有确定基准 */
  function fitBoard(el, cols, rows) {
    var sc = document.querySelector('.board-scroll');
    if (!sc) { return; }
    el.style.boxSizing = 'border-box';
    var cs = getComputedStyle(el);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    /* 教学模式下文字条是 fixed 浮层，不占 board-scroll 的高度 —— 要手动扣掉 */
    var barH = 0;
    if (document.body && document.body.classList.contains('tut-on')) {
      var bar = document.querySelector('.tut-bar');
      if (bar) { barH = bar.offsetHeight; }
    }
    var availW = sc.clientWidth - 8 - 4;   /* 滚动条已隐藏，只留 4px 余量 */
    var availH = sc.clientHeight - 8 - 4 - barH;
    var ratio = cols / rows;
    if (window.__DIVE_DEBUG) {
      console.log('[FIT] availW=' + availW + ' availH=' + availH + ' ratio=' + ratio.toFixed(3) + ' pad=' + padX + 'x' + padY);
      console.log('[FIT] scroll.clientHeight=' + sc.clientHeight + ' wrap.clientHeight=' + (sc.parentElement ? sc.parentElement.clientHeight : 0) + ' app.clientHeight=' + (sc.parentElement && sc.parentElement.parentElement ? sc.parentElement.parentElement.clientHeight : 0));
    }
    if (availW <= 0 || availH <= 0) {
      if (window.__DIVE_DEBUG) { console.log('[FIT] 跳过 availW=' + availW + ' availH=' + availH); }
      return;
    }
    /* 外框尺寸（border-box，含 padding+border）
     * 竖长盘（rows > cols）：铺满宽度，高度自然超出 → 由外层滚动
     * 方形 / 横盘：宽高取小，保证一屏放得下 */
    var W;
    if (rows > cols) {
      W = availW;
    } else {
      W = Math.min(availW, (availH - padY) * ratio + padX);
    }
    var H = (W - padX) / ratio + padY;
    el.style.width = Math.round(W) + 'px';
    el.style.height = Math.round(H) + 'px';
    var topGap = Math.max(0, Math.round((availH - H) / 2));
    el.style.marginTop = topGap + 'px';
    if (window.__DIVE_DEBUG) { console.log('[FIT] topGap=' + topGap); }
    /* 垂直水平居中交给 CSS 的 margin: auto（flex 里溢出时自动退化为 0，不裁顶） */
    if (window.__DIVE_DEBUG) { console.log('[FIT] w=' + Math.round(W) + ' h=' + Math.round(H) + ' board=' + el.offsetWidth + 'x' + el.offsetHeight); }
  }

  /* 每次渲染都按当前容器重算尺寸 */
  function render(state) {
    if (state && state.cfg && boardEl) {
      fitBoard(boardEl, state.cfg.cols, state.cfg.rows);
      /* 布局稳定后再算一次：首次测量时容器高度可能还没定 */
      window.requestAnimationFrame(function () {
        if (boardEl && state && state.cfg) { fitBoard(boardEl, state.cfg.cols, state.cfg.rows); }
      });
    }
    if (window.__DIVE_DEBUG) {
      console.log('[DIVE] render ' + state.cfg.cols + 'x' + state.cfg.rows + ' cells=' + cellEls.length);
    }
    if (cellEls.length !== state.cfg.cols * state.cfg.rows || lastRenderedSeed !== state.seed) {
      buildBoard(state);
    }

    /*
     * board 还没铺（新关卡的首点之前）：只能画 cfg 能提供的信息。
     * 这里必须提前 return —— 往下会调 L.remainingMines(state)，它要读 state.board，
     * 抛错就会「状态换了、画面没换」，这正是新关卡看到上一关棋盘的原因。
     */
    if (!state.board) {
      paintOxygen(state);
      var dbox0 = document.querySelector('.stat.depth');
      if (dbox0 && dbox0.classList) { dbox0.classList.remove('exit'); }
      paintMines(state);
      paintBottles(state);
      return;
    }
    /* 顺序很重要：必须先建棋盘再上色。反过来的话第一次 render 时 cellEls 还是空的，
     * 裂纹 / 提示高亮会被整批丢掉（这个 bug 实际踩到过）。 */
    paintOxygen(state);

    var depthBox = document.querySelector('.stat.depth');
    if (depthBox && depthBox.classList) {
      var wasExit = depthBox.classList.contains('exit');
      depthBox.classList.toggle('exit', !!state.doorOpened);
      /* 刚从「没找到出口」变成「找到」：放大缩小一下，让玩家看见 */
      if (!wasExit && state.doorOpened) {
        depthBox.classList.remove('pop');
        void depthBox.offsetWidth;
        depthBox.classList.add('pop');
        window.setTimeout(function () { depthBox.classList.remove('pop'); }, 700);
      }
    }
    paintMines(state);


    /*
     * 进度：永远不写「7/5」这种。
     * 分子封顶在配额，超出的部分写在同一行：「5/5 · 额外 +2」。
     */
    var extra = 0;
    /* 进度：还没开的氧气瓶数量（门开后旁边挂 ×2） */
    paintBottles(state);

    var chip = $('stat-extra');
    if (state.cleared && extra > 0) {
      chip.textContent = '· 额外 +' + extra;
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }


    /* 通关是一个「标记」，不是结束 —— 达标后这里变绿，游戏继续 */
    $('stat-bottle-box').classList.toggle('cleared', !!state.cleared);

    /* v11 氧气不封顶（开箱/清场都会加），所以血条要夹在 100% 以内，
     * 否则条子会撑出容器。超出的部分靠数字和上浮反馈表达。 */
    /* 氧气条恒按 100 算：cfg.oxygen 是「进层时的氧气」，拿它当分母会让 89/89 显示成满格 */
    var pct = Math.min(100, Math.max(0, state.oxygen) / (state.cfg.oxygenCap || 100) * 100);
    /* 达标后给出口：不强制，玩家可以继续打捞，也可以直接下潜 */


    var fill = $('oxy-fill');


    applyHudLabels();
    for (var i = 0; i < cellEls.length; i++) {
      var root = cellEls[i].root;
      var span = cellEls[i].n;
      var open = state.open[i];
      var cls = 'cell';
      var text = '';
      var isDoor = (i === state.door);
      var doubled = !!(state.doorOpened || state.revealedAll);

      if (open === L.OPEN_SAFE) {
        var r = state.readings[i];
        cls += ' revealed';
        if (r && r.total > 0) {
          var forced = state.forceColor && state.forceColor[i];
        if (forced === 'mixed') { cls += ' c-mixed'; }
        else if (forced === 'red') { cls += ' c-red'; }
        else if (forced === 'blue') { cls += ' c-blue'; }
        else if (r.color === L.RED) { cls += ' c-red'; }
          else if (r.color === L.BLUE) { cls += ' c-blue'; }
          else { cls += ' c-mixed'; }
          text = String(r.total);
        } else {
          cls += ' c-blank';
        }
      } else if (open === L.OPEN_MINE) {
        cls += ' revealed c-mine';
        /* 图标由 CSS 画（红色实心球），这里不写字 */
        text = '';
      } else if (open === L.OPEN_BOTTLE) {
        /* 摊开后露出的瓶子：门格仍画漩涡，其余按瓶子 */
        cls += isDoor ? ' revealed c-door' : (' revealed c-bottle' + (doubled ? ' x2' : ''));
      } else if (open === L.OPEN_CHEST && isDoor) {
        cls += ' revealed c-door';
      } else if (open === L.OPEN_CHEST) {
        cls += ' revealed c-chest';
        /* 图标由 CSS 画（金色箱体），这里不写字 */
        text = '';
      } else if (state.marks[i]) {
        cls += ' marked';
      text = '';
      }

      /*
       * 裂纹必须并进这一串 class：这里对 root.className 是**整串赋值**，       */

      /* 提示高亮也并进这串 class，重画时才不会丢 */
      if (hl.source[i]) { cls += ' hint-source'; }
      if (hl.known[i]) { cls += ' hint-known'; }
      if (hl.reveal[i]) { cls += ' hint-reveal'; }

      if (markHint.idx === i) { cls += ' mark-hint' + (markHint.strong ? ' strong' : ''); }

      if (root.className !== cls) { root.className = cls; }
      if (span.textContent !== text) { span.textContent = text; }
    }
  }

  /* ---------- 事件反馈 ---------- */

  function pulse(idx, cls) {
    var item = cellEls[idx];
    if (!item) { return; }
    var root = item.root;
    root.classList.remove(cls);
    if (root.offsetWidth >= 0) { void root.offsetWidth; }
    root.classList.add(cls);
    window.setTimeout(function () { root.classList.remove(cls); }, 420);
  }

  /* 每次消耗/获得都闪一下数字，让玩家看见钱在动 */
  function flashStat(id) {
    var el = $(id);
    if (!el) { return; }
    el.classList.remove('flash');
    void el.offsetWidth;      /* 强制重排，动画才能重放 */
    el.classList.add('flash');
  }

  /*
   * 氧气变化的两套动效（v12）。方向和颜色必须一眼分得开：
   *   增加：绿色数字向上浮 + 血条向右滑、末端回弹
   *   减少：红色数字向下沉 + 血条向左滑、整条短促抖动
   * 全部是 CSS 动画，JS 只加/去 class，不阻塞任何操作。
   */
  /* 非阻塞的一次性提示条：贴在提示按钮上，不挡操作 */
  function toast(text) {
    var host = $('hint-btn');
    if (!host) { return; }
    var old = host.parentNode && host.parentNode.querySelector
      ? host.parentNode.querySelector('.toast') : null;
    if (old && old.parentNode && old.parentNode.removeChild) { old.parentNode.removeChild(old); }
    var el = document.createElement('span');
    el.className = 'toast';
    el.textContent = text;
    if (!host.parentNode || typeof host.parentNode.appendChild !== 'function') { return; }
    host.parentNode.appendChild(el);
    setTimeout(function () {
      if (el.parentNode && typeof el.parentNode.removeChild === 'function') { el.parentNode.removeChild(el); }
    }, 1800);
  }

  function oxyFloat(text, up, extraCls) {
    var host = $('stat-oxy-box');
    if (!host) { return; }
    var f = document.createElement('span');
    f.className = 'oxy-float ' + (up ? 'up' : 'down') + (extraCls ? ' ' + extraCls : '');
    f.textContent = text;
    host.appendChild(f);
    /* 动画结束自己收掉；不等它，绝不挡下一下点击 */
    var clear = function () {
      if (f.parentNode && typeof f.parentNode.removeChild === 'function') { f.parentNode.removeChild(f); }
    };
    setTimeout(clear, up ? 1600 : 1400);
  }

  function oxyBar(kind) {
    var bar = $('oxy-bar');
    if (!bar) { return; }
    bar.classList.remove('grow', 'shake');
    void bar.offsetWidth;
    bar.classList.add(kind === 'up' ? 'grow' : 'shake');
    setTimeout(function () { bar.classList.remove('grow', 'shake'); }, 620);
  }

  /* 氧气三档：致命(红闪)/警戒(橙黄)/安全，唯一写入点 */
  function paintOxygen(state) {
    if (!state || !state.cfg) { return; }
    var box = $('stat-oxy-box');
    if (!box) { return; }
    /* 数字 + 血条：唯一写入点 */
    var num = $('stat-oxy');
    if (num) { num.textContent = String(state.oxygen); }
    var cap = state.cfg.oxygenCap || 100;
    var pct = Math.min(100, Math.max(0, state.oxygen) / cap * 100);
    var fill = $('oxy-fill');
    if (fill) { fill.style.width = pct + '%'; }
    /* 满氧 */
    box.classList.remove('full');
    if (state.oxygen >= cap) { box.classList.add('full'); }
    /* 三档：先清再加，互斥 */
    box.classList.remove('critical');
    box.classList.remove('warnly');
    var isTut = document.body && document.body.classList && document.body.classList.contains('tut-on');
    if (isTut) { return; }   /* 教学关永远安全档 */
    var hit = state.cfg.mineCost || 20;
    var oxy = state.oxygen;
    if (oxy <= hit) { box.classList.add('critical'); }
    else if (oxy <= hit * 2) { box.classList.add('warnly'); }
  }

  /* 暗礁计数：未撞到 / 总数（棋盘没铺时一颗都没撞，所以 total/total） */
  function paintMines(state) {
    var el = $('stat-mines');
    if (!el || !state || !state.cfg) { return; }
    var remaining = state.board ? L.remainingMines(state) : state.cfg.mines;
    el.textContent = remaining + '/' + state.cfg.mines;
  }

  /* 氧气瓶计数：还没开启的数量（棋盘没铺时等于总数） */
  function paintBottles(state) {
    var el = $('stat-bottle');
    if (!el || !state || !state.cfg) { return; }
    var left = 0;
    if (state.board) {
      for (var bi = 0; bi < state.open.length; bi++) {
        if (state.board.cells[bi] === L.CHEST && state.open[bi] === L.HIDDEN) { left++; }
      }
    } else {
      left = state.cfg.chests;
    }
    el.textContent = String(left);
    if ($('bottle-sub')) {
      var bs = $('bottle-sub');
      bs.textContent = state.doorOpened ? '奖励 ×2' : '';
      bs.className = state.doorOpened ? 'k2 shown' : 'k2';
    }
  }

  /* 掉落反馈：数字从格子里往上飘一下，别只闪 HUD */
  /*
   * 全局浮字层：盖在整个棋盘上。
   * 以前浮字挂在格子元素里，而 .cell 有 overflow:hidden —— 飘出格子就被裁掉，
   * 这是「空箱」「+6」看不全的根因。现在锚点仍是格子，但父节点是这一层，
   * 裁剪边界变成整个棋盘。
   */
  var floatLayer = null;

  function ensureFloatLayer() {
    var host = $('board');
    if (!host) { return null; }
    if (floatLayer && floatLayer.parentNode === host) { return floatLayer; }
    var old = host.querySelector ? host.querySelector('.float-layer') : null;
    if (old && old.parentNode) { old.parentNode.removeChild(old); }
    floatLayer = document.createElement('div');
    floatLayer.className = 'float-layer';
    host.appendChild(floatLayer);
    return floatLayer;
  }

  /* dir: 'up'（增加，从格子上方起向上飘）/ 'down'（减少，从格子下方起向下飘） */
  function floatGain(idx, text, cls, dir) {
    var cell = cellEls[idx];
    if (!cell) { return; }
    var layer = ensureFloatLayer();
    if (!layer) { return; }
    var down = dir === 'down';
    var f = document.createElement('span');
    f.className = 'float-gain ' + (down ? 'down' : 'up') + (cls ? ' ' + cls : '');
    f.textContent = text;
    var cx = cell.root.offsetLeft + cell.root.offsetWidth / 2;
    var cy = down ? (cell.root.offsetTop + cell.root.offsetHeight) : cell.root.offsetTop;
    f.style.left = cx + 'px';
    f.style.top = cy + 'px';
    layer.appendChild(f);
    setTimeout(function () {
      if (f.parentNode && typeof f.parentNode.removeChild === 'function') { f.parentNode.removeChild(f); }
    }, cls === 'dry' ? 1400 : 1600);
  }

  /* 达标时不能错过的大信号：整条进度闪一下 + 屏幕中央一句话，1.2 秒自己消失 */
  /* 通用中央横幅：不阻塞操作，到点自己消失 */
  /* 自动清场：那一片同时亮开（错开 18ms 依次点亮，看起来像"塌下来"） */
  /*
   * A10：全盘展开的声呐扫描。
   * 一道波从棋盘中心往外扫，波扫过的格子依次亮起（700–1000ms）。
   * 纯 CSS 动画，不改 pointer-events —— 动画期间玩家照样能点。
   */
  function playSonar(idxs, cols) {
    var board = $('board');
    if (!board || !board.classList || !idxs || !idxs.length) { return; }
    var c = cols || 9;
    var rows = Math.ceil(cellEls.length / c);
    var cx = (c - 1) / 2, cy = (rows - 1) / 2;
    var maxDelay = 0;
    board.classList.add('sonar');
    for (var k = 0; k < idxs.length; k++) {
      var el = cellEls[idxs[k]];
      if (!el || !el.root) { continue; }
      var x = idxs[k] % c, y = Math.floor(idxs[k] / c);
      var d = Math.abs(x - cx) + Math.abs(y - cy);
      var delay = Math.min(420, Math.round(d * 55));
      el.root.style.animationDelay = delay + 'ms';
      if (delay > maxDelay) { maxDelay = delay; }
    }
    setTimeout(function () {
      board.classList.remove('sonar');
      for (var j = 0; j < idxs.length; j++) {
        var e2 = cellEls[idxs[j]];
        if (e2 && e2.root) { e2.root.style.animationDelay = ''; }
      }
    }, maxDelay + 900);
  }

  function paintAutoClear(idxs) {
    if (!idxs || !idxs.length) { return; }
    for (var k = 0; k < idxs.length; k++) {
      (function (i, delay) {
        setTimeout(function () {
          var el = cellEls && cellEls[i];
          if (!el || !el.root) { return; }
          el.root.classList.add('autoclear');
          setTimeout(function () { el.root.classList.remove('autoclear'); }, 620);
        }, delay);
      })(idxs[k], k * 18);
    }
  }

  function bannerHost() {
    var layer = $('banner-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'banner-layer';
      layer.className = 'banner-layer';
      document.body.appendChild(layer);
    }
    return layer;
  }

  function showBanner(mainText, subText, ms, cls) {
    var host = bannerHost();
    if (!host) { return; }
    var old = host.querySelector ? host.querySelector('.clear-banner') : null;
    if (old && old.parentNode && old.parentNode.removeChild) { old.parentNode.removeChild(old); }
    var el = document.createElement('div');
    el.className = 'clear-banner animation-keep' + (cls ? ' ' + cls : '');
    var b = document.createElement('b');
    b.textContent = mainText;
    el.appendChild(b);
    if (subText) {
      var sp = document.createElement('span');
      sp.textContent = subText;
      el.appendChild(sp);
    }
    host.appendChild(el);
    setTimeout(function () {
      if (el.parentNode && typeof el.parentNode.removeChild === 'function') { el.parentNode.removeChild(el); }
    }, ms || 2000);
  }



  function setMods(list) {
    /* 难度提示已全部移除（用户要求）：保留空实现 */
  }

  /*
  
   * 只留棋盘和数字，让玩家自己从颜色和后果里推规则。
   */
  
  /* 标记暗示：idx = -1 表示清掉 */




  


  /* 界面巡览：依次高亮五个点，带「跳过」 */





  /* 难度提示已移除 */
  function setPressure(name, shape) {
    /* 难度提示已移除 */
  }


  function setPractice(on) {
    if (document.body && document.body.classList) {
      document.body.classList.toggle('practice', !!on);
    }
  }



  /* 模式按钮上直接写当前模式，切了就变 */
  function setModeLabel(classic) {
    var b = $('mode-btn');
    if (b) { b.textContent = classic ? '经典模式' : '复杂模式'; }
    if (document.body && document.body.classList) {
      document.body.classList.toggle('classic', !!classic);
    }
  }

  function setDepthLabel(text) {
    var el = $('stat-depth');
    if (el) { el.textContent = String(text); }
  }



  function playEvents(events) {
    for (var i = 0; i < events.length; i++) {
      var ev0 = events[i];
      var hasChest = false;
      var hasMine = false;
      var stepCost = 0;
      for (var hc = 0; hc < events.length; hc++) {
        if (events[hc].type === 'chest' && events[hc].gained > 0) { hasChest = true; }
        if (events[hc].type === 'mine') { hasMine = true; }
        if (events[hc].type === 'step') { stepCost = events[hc].cost; }
      }

      /*
       * 开箱：只报**净变化**（箱子 − 这一步的行动点），不拆账。
       * 普通箱 +8 − 2 = +6；稀有箱 +20 − 2 = +18。走「增加」那套视觉与时长（1600ms，绿色向上）。
       */
      if (ev0.type === 'chest') {
        if (ev0.gained > 0) {
          var net = ev0.gained - stepCost;
          var netText = (net >= 0 ? '+' : '−') + Math.abs(net);
          floatGain(ev0.idx, netText, ev0.rare ? 'rare' : '', net >= 0 ? 'up' : 'down');
          if (net >= 0) { oxyBar('up'); } else { oxyBar('down'); }
          flashStat('stat-oxy');
        } else if (ev0.destroyed) {
          floatGain(ev0.idx, '空箱', 'dry', 'up');
        }
      }



      /* 减少：从格子下方起向下飘。开箱那一下走「净变化」，这里不重复飘 */
      if (ev0.type === 'step' && !hasChest && !hasMine) {
        floatGain(ev0.idx, '−' + ev0.cost, '', 'down');
        oxyBar('down');
        flashStat('stat-oxy');
      }
      /* 撞暗礁：伤害和这一下的行动点合成一个数（玩家要结论，不要账本） */
      if (ev0.type === 'mine') {
        floatGain(ev0.idx, '−' + (ev0.cost + stepCost), 'bad', 'down');
        oxyBar('down');
        flashStat('stat-oxy');
      }
      /* 提示扣费单独标出来，和普通掉氧区分 */
      if (ev0.type === 'hint-cost') {
        oxyFloat('−' + ev0.cost, false, 'hint');
        oxyBar('down');
        flashStat('stat-oxy');
      }
      var e = events[i];
      if (e.type === 'mine') { pulse(e.idx, 'flash-bad'); }
      else if (e.type === 'chest') { pulse(e.idx, 'flash-good'); }
      else if (e.type === 'mark' && e.on) { pulse(e.idx, 'flash-mark'); }
    }
  }

  /* ---------- 输入 ---------- */

  function cellFromEvent(ev) {
    var t = ev.target;
    while (t && t !== boardEl) {
      if (t.getAttribute && t.getAttribute('data-idx') != null) { return t; }
      t = t.parentNode;
    }
    return null;
  }

  function idxFromEvent(ev) {
    var cell = cellFromEvent(ev);
    if (!cell) { return -1; }
    var idx = parseInt(cell.getAttribute('data-idx'), 10);
    return isNaN(idx) ? -1 : idx;
  }

  function cancelPress() {
    if (pressTimer) { window.clearTimeout(pressTimer); pressTimer = null; }
    pressOrigin = null;
  }

  function bindInput() {
    /* 左键 / 触摸点击：翻开 */
    boardEl.addEventListener('click', function (ev) {
      if (suppressClick) { suppressClick = false; return; }
      var idx = idxFromEvent(ev);
      if (idx < 0) { return; }
      if (handlers.onOpen) { handlers.onOpen(idx); }
    });

    /* 右键：开关暗礁标记 */
    boardEl.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      var idx = idxFromEvent(ev);
      if (idx < 0) { return; }
      fireMark(idx);
    });

    /*
     * 长按（给手机版留的入口）：只在触摸/手写笔下生效。
     * 鼠标不走长按 —— 否则「按住左键慢慢点」会被当成标记，很难受。
     */
    boardEl.addEventListener('pointerdown', function (ev) {
      cancelPress();
      suppressClick = false;
      if (ev.button !== 0) { return; }
      if (ev.pointerType === 'mouse') { return; }

      var idx = idxFromEvent(ev);
      if (idx < 0) { return; }

      pressOrigin = { x: ev.clientX, y: ev.clientY };
      pressTimer = window.setTimeout(function () {
        pressTimer = null;
        pressOrigin = null;
        suppressClick = true;
        fireMark(idx);
      }, LONG_PRESS_MS);
    });

    /*
     * 手机长按补一条 touch 通道：DevTools 设备模式/真机里 pointercancel 或细微抖动
     * 会把 pointerdown 的计时器提前取消，导致长按永远不出标记。
     */
    boardEl.addEventListener('touchstart', function (ev) {
      if (!ev.touches || ev.touches.length !== 1) { return; }
      var idx = idxFromEvent(ev);
      if (idx < 0) { return; }
      cancelPress();
      suppressClick = false;
      var t = ev.touches[0];
      pressOrigin = { x: t.clientX, y: t.clientY };
      pressTimer = window.setTimeout(function () {
        pressTimer = null;
        pressOrigin = null;
        suppressClick = true;
        fireMark(idx);
      }, LONG_PRESS_MS);
    }, { passive: true });

    boardEl.addEventListener('touchmove', function (ev) {
      if (!pressOrigin || !ev.touches || ev.touches.length !== 1) { return; }
      var t = ev.touches[0];
      var dx = t.clientX - pressOrigin.x;
      var dy = t.clientY - pressOrigin.y;
      if (dx * dx + dy * dy > 18 * 18) { cancelPress(); }   /* 手指抖动容忍放大到 18px */
    }, { passive: true });

    boardEl.addEventListener('touchend', cancelPress);
    boardEl.addEventListener('touchcancel', cancelPress);

    boardEl.addEventListener('pointermove', function (ev) {
      if (!pressOrigin) { return; }
      var dx = ev.clientX - pressOrigin.x;
      var dy = ev.clientY - pressOrigin.y;
      if (dx * dx + dy * dy > MOVE_TOLERANCE * MOVE_TOLERANCE) { cancelPress(); }
    });

    boardEl.addEventListener('pointerup', cancelPress);
    boardEl.addEventListener('pointercancel', cancelPress);
    boardEl.addEventListener('pointerleave', cancelPress);

    $('restart').addEventListener('click', function () {
      if (handlers.onRestart) { handlers.onRestart(); }
    });
    $('overlay-restart').addEventListener('click', function () {
      if (handlers.onRestart) { handlers.onRestart(); }
    });
    $('hint-btn').addEventListener('click', function () {
      if (handlers.onHint) { handlers.onHint(); }
    });

    var modeBtn = $('mode-btn');
    if (modeBtn) {
      modeBtn.addEventListener('click', function () {
        if (handlers.onToggleMode) { handlers.onToggleMode(); }
      });
    }




    /* 修饰符标识：点一下展开/收起本层修饰符列表 */
    

    $('hint-close').addEventListener('click', clearHint);
  }

  /* ---------- 结算浮层 ---------- */

  /*
   * 结算浮层。
   *
   * 三种收尾：
   *   perfect —— 全开，最好的结局，给恭喜 + 统计
   *   cleared —— 达标但氧气耗尽
   *   end     —— 没达标，氧气耗尽
   *
   * 全开那一种不糊掉棋盘（CSS .overlay.perfect），让玩家还能看见自己解完的那一盘。
   */
  function statRow(label, value) {
    return '<div class="stat-row"><span>' + label + '</span><b>' + value + '</b></div>';
  }

  function fmtTime(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function showOverlay(state, info) {
    info = info || {};
    var ov = $('overlay');
    var title = $('overlay-title');
    var perfect = !!state.perfect;
    var cleared = !!state.cleared;
    var rows = [];
    var extra = 0;  /* v20：没有配额，额外数恒为 0 */

    if (perfect) {
      title.textContent = '全部打捞完成';
      title.className = 'overlay-title perfect';
      ov.classList.add('perfect');
      rows.push(statRow('用时', fmtTime(info.elapsedMs != null ? info.elapsedMs : (info.activeMs || 0))));
      rows.push(statRow('剩余氧气', state.oxygen + ' / ' + state.cfg.oxygen));
      rows.push(statRow('打捞氧气瓶', state.collected + ' / ' + state.cfg.chests +
        (extra > 0 ? '　额外 +' + extra : '')));
      rows.push(statRow('撞暗礁', state.sunk + ' 次'));
      rows.push(statRow('海底编号', '#' + state.seed));
    } else {
      title.textContent = '本层结束';
      title.className = 'overlay-title ' + (cleared ? 'clear' : 'end');
      ov.classList.remove('perfect');
      rows.push(statRow('结果', cleared ? '<b>找到漩涡</b>' : '<b>没找到漩涡</b>'));
      rows.push(statRow('用时', fmtTime(info.elapsedMs != null ? info.elapsedMs : (info.activeMs || 0))));
      rows.push(statRow('打捞氧气瓶', state.collected + ' 个' +
        (extra > 0 ? '　额外 +' + extra : '')));
      rows.push(statRow('氧气', state.oxygen + ' / ' + state.cfg.oxygen));
      rows.push(statRow('撞暗礁', state.sunk + ' 次'));
      rows.push(statRow('海底编号', '#' + state.seed));
      rows.push('<div class="overlay-note">已得奖励全部保留，不算失败</div>');
    }

    $('overlay-body').innerHTML = rows.join('');
    ov.hidden = false;
  }

  function hideOverlay() {
    $('overlay').hidden = true;
    $('overlay').classList.remove('perfect');
  }

  /* ---------- 提示 ---------- */

  /* 当前深度（肉鸽层：一次下潜是一串海床） */
  function setDepth(n) {
    var el = $('stat-depth');
    if (!el) { return; }
    el.textContent = '第 ' + n + ' 层';
  }

  /*
   * 下潜层的结算浮层：到第几层、总打捞、历史最佳。
   * 和单层的 showOverlay 分开 —— 那个讲的是这一层，这个讲的是一次下潜。
   */
  var runOverlayAction = null;

function clearHint() {
    $('hintbar').hidden = true;
    $('hinttext').textContent = '';

    for (var i = 0; i < cellEls.length; i++) {
      cellEls[i].root.classList.remove('hint-source', 'hint-target', 'hint-group', 'hint-reveal', 'hint-known', 'hint-seen');
    }
    hl.source = {};
    hl.known = {};
    hl.reveal = {};
  }



  /*
   * 第 1 级：高亮「相关的读数格」+「它们共同约束的未知格」。
   * 有一步能讲清的推理就配一句话；没有就只亮，不说话。
   */


  /* ---------- 多拍演示（v9：全程无文字） ---------- */

  var animTimer = null;
  var animBusy = false;

  function hlSlot(cls) {
    if (cls === 'hint-source') { return hl.source; }
    if (cls === 'hint-known') { return hl.known; }
    if (cls === 'hint-reveal') { return hl.reveal; }
    return null;
  }

  function lit(idx, cls) {
    var slot = hlSlot(cls);
    if (slot) { slot[idx] = true; }
    var el = cellEls[idx];
    if (el) { el.root.classList.add(cls); }
  }



  function stopAnim() {
    if (animTimer) { clearTimeout(animTimer); animTimer = null; }
    animBusy = false;
  }

  /*
   * 一拍：来源亮 300ms → 熄 200ms → 结论格点亮并**保留**（known）
   * 全部拍完再闪目标，然后交给调用方执行。
   */


  function isAnimating() { return animBusy; }

  /* 执行完再补一次标记（render 会重建 class） */
  function markReveal(idx) { lit(idx, 'hint-reveal'); }

  /* 第 2 级：保留高亮，把目标格单独标出来 */


  /*
   * 致命错误。唯一的来源是生成闸门连续 MAX_ATTEMPTS 次都没生成出可解棋盘
   * —— 几乎不可能发生，真发生了说明求解器或生成逻辑坏了。
   * 无论如何都要显示出来，不能静默卡死。
   */
  /*
   * 脚本错误红条：固定顶部，不挡棋盘操作区，点一下消失。
   * 和 showFatal 分开——showFatal 是全屏浮层（生成失败用），不能复用。
   */
  function fatalBar(message) {
    var box = $('fatal-bar');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fatal-bar';
      box.className = 'fatal-bar';
      box.addEventListener('click', function () { box.innerHTML = ''; box.hidden = true; });
      document.body.appendChild(box);
    }
    box.hidden = false;
    var row = document.createElement('div');
    row.textContent = message;
    box.appendChild(row);
    while (box.childNodes.length > 4) { box.removeChild(box.firstChild); }
  }

  function showFatal(message) {
    var title = $('overlay-title');
    title.textContent = '生成失败';
    title.className = 'overlay-title end';
    $('overlay-body').innerHTML =
      message + '<br><br>点「重新下潜」再试一次。';
    $('overlay').hidden = false;
  }

  /* ---------- 初始化 ---------- */

  function init(opts) {
    handlers = opts || {};
    boardEl = $('board');
    bindInput();
  }

  /* 减少动态效果：游戏内开关优先，其次系统设置。每次调用都重新读。 */
  function reducedMotion() {
    if (document.body && document.body.classList && document.body.classList.contains('reduce-motion')) {
      return true;
    }
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  return {
    reducedMotion: reducedMotion,
    init: init,
    render: render,
    playEvents: playEvents,
    showBanner: showBanner,
    showOverlay: showOverlay,
    hideOverlay: hideOverlay,
    showFatal: showFatal,
    fatalBar: fatalBar,

    setMods: setMods,
    setPractice: setPractice,
    setPressure: setPressure,
    paintAutoClear: paintAutoClear,
    playSonar: playSonar,
    setDepthLabel: setDepthLabel,
    setModeLabel: setModeLabel,
    toast: toast,
    setDepth: setDepth,
    oxyFloat: oxyFloat,
    setHintLeft: function (n) {
      var left = (typeof n === 'number') ? n : 0;
      var text = left > 0 ? ('提示 剩' + left + '次') : '提示 次数用完';
      var b = $('hint-btn');
      if (b) {
        b.textContent = text;
        if (left > 0) { b.classList.remove('disabled'); b.disabled = false; }
        else { b.classList.add('disabled'); b.disabled = true; }
      }
      var f = $('tut-hint-fab');
      if (f) { f.textContent = text; }
    },
    isAnimating: isAnimating,
    markReveal: markReveal,
    stopAnim: stopAnim,
    clearHint: clearHint
  };
})();













































































