/*
 * 结算界面（通关 / 失败共用一套骨架，靠 skin 区分）
 * 只做结构与真实数据；本轮不做动效、粒子、数字滚动、保存图片。
 */
(function (global) {
  'use strict';

  /* ---------- 格式化 ---------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtDate(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 '
      + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtDur(ms) {
    var s = Math.max(0, Math.round((ms || 0) / 1000));
    if (s >= 3600) {
      var h = Math.floor(s / 3600);
      var m = Math.floor((s % 3600) / 60);
      return h + ' 小时 ' + m + ' 分';
    }
    if (s >= 60) { return Math.floor(s / 60) + ' 分'; }
    return s + ' 秒';
  }

  function fmtNum(n) {
    var s = String(Math.round(n || 0));
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) { out += ','; }
      out += s.charAt(i);
    }
    return out;
  }

  /* ---------- 渲染 ---------- */
  function $(id) { return document.getElementById(id); }

  var handlers = { primary: null, home: null };

  /* 每次打开结算时重新读（玩家可能中途改了设置）；游戏内开关优先 */
  var reduceMotion = false;
  function refreshMotion() {
    if (window.DeepDiveUI && DeepDiveUI.reducedMotion) { reduceMotion = DeepDiveUI.reducedMotion(); return; }
    reduceMotion = document.body && document.body.classList.contains('reduce-motion');
  }

  /* 粒子：只在进场时建一次节点，动画交给 CSS */
  function buildParticles(layer, skin) {
    var host = $('result-particles');
    if (!host) { return; }
    host.innerHTML = '';
    if (reduceMotion) { return; }
    var count = skin === 'win' ? 24 : 12;
    for (var i = 0; i < count; i++) {
      var dot = document.createElement('i');
      var left = Math.round(Math.random() * 100);
      var dur = (skin === 'win' ? 5.5 : 9) + Math.random() * (skin === 'win' ? 4.5 : 6);
      var delay = Math.random() * 4;
      var size = 3 + Math.round(Math.random() * 3);
      dot.style.left = left + '%';
      dot.style.width = size + 'px';
      dot.style.height = size + 'px';
      dot.style.animationDuration = dur.toFixed(2) + 's';
      dot.style.animationDelay = delay.toFixed(2) + 's';
      host.appendChild(dot);
    }
  }

  /* 数字滚动：只对纯数字项，800ms 一次性 rAF（不是每帧改布局） */
  function rollNumber(el, target, unit) {
    if (reduceMotion) { el.textContent = fmtNum(target) + (unit || ''); return; }
    var start = 0;
    var t0 = 0;
    var dur = 800;
    function step(ts) {
      if (!t0) { t0 = ts; }
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtNum(Math.round(target * eased)) + (unit || '');
      if (p < 1) { window.requestAnimationFrame(step); }
    }
    window.requestAnimationFrame(step);
  }

  function show(opts) {
    opts = opts || {};
    refreshMotion();   /* 每次打开都重新判定 */
    var skin = opts.skin === 'win' ? 'win' : 'lose';
    var layer = $('result-layer');
    if (!layer) { return; }

    layer.hidden = false;
    layer.className = 'result-layer ' + skin;

    var kicker = $('result-kicker');
    if (kicker) { kicker.textContent = skin === 'win' ? '你潜到了海底！' : '你停在了第 ' + (opts.depth || 1) + ' 层'; }

    var title = $('result-title');
    if (title) { title.textContent = opts.title || (skin === 'win' ? '通关' : '本次下潜结束'); }

    var badge = $('result-badge');
    if (badge) {
      /* badge: 'perfect' | 'clean' | null（perfect 优先，不叠加） */
      var kind = (skin === 'win') ? (opts.badge || (opts.perfect ? 'perfect' : null)) : null;
      badge.hidden = !kind;
      badge.className = 'result-badge' + (kind === 'clean' ? ' clean' : '');
      badge.textContent = kind === 'perfect' ? '完美推理' : (kind === 'clean' ? '零撞礁' : '');
    }

    var body = $('result-rows');
    var rollJobs = [];
    if (body) {
      body.innerHTML = '';
      var rows = opts.rows || [];
      for (var i = 0; i < rows.length; i++) {
        var row = document.createElement('div');
        row.className = 'result-row';
        row.style.setProperty('--i', reduceMotion ? 0 : i);
        var k = document.createElement('span');
        k.className = 'rk';
        k.textContent = rows[i].k;
        var v = document.createElement('span');
        v.className = 'rv';
        var pureNum = (typeof rows[i].n === 'number');
        v.textContent = pureNum ? (fmtNum(rows[i].n) + (rows[i].unit || '')) : rows[i].v;
        row.appendChild(k);
        row.appendChild(v);
        body.appendChild(row);
        if (pureNum) {
          rollJobs.push({ el: v, n: rows[i].n, unit: rows[i].unit || '', i: i });
        }
      }
    }

    buildParticles(layer, skin);
    layer.classList.remove('anim');
    /* 下一帧再加 anim，保证 transition/animation 真的跑起来 */
    window.requestAnimationFrame(function () {
      layer.classList.add('anim');
      for (var j = 0; j < rollJobs.length; j++) {
        (function (job) {
          if (reduceMotion) { rollNumber(job.el, job.n, job.unit); return; }
          var delay = 1000 + job.i * 120;
          window.setTimeout(function () { rollNumber(job.el, job.n, job.unit); }, delay);
        })(rollJobs[j]);
      }
    });

    var primary = $('result-primary');
    if (primary) {
      primary.textContent = opts.primaryLabel || (skin === 'win' ? '保存这张图' : '重新下潜');
      handlers.primary = opts.onPrimary || null;
    }
    handlers.home = opts.onHome || null;
  }

  function hide() {
    var layer = $('result-layer');
    if (layer) {
      layer.hidden = true;
      layer.classList.remove('anim');
      var host = $('result-particles');
      if (host) { host.innerHTML = ''; }
    }
    handlers.primary = null;
    handlers.home = null;
  }

  function bind() {
    var p = $('result-primary');
    if (p) {
      p.addEventListener('click', function () {
        var fn = handlers.primary;
        if (fn) { fn(); }
      });
    }
    var h = $('result-home');
    if (h) {
      h.addEventListener('click', function () {
        var fn = handlers.home;
        if (fn) { fn(); } else { window.location.reload(); }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  global.DeepDiveResult = {
    show: show,
    hide: hide,
    fmtDate: fmtDate,
    fmtDur: fmtDur,
    fmtNum: fmtNum
  };
})(window);
