/*
 * 深潜 · 背景 v13（2026-11-13 定稿）
 *
 * 只有四个元素，全部 CSS 画，不用任何素材文件：
 *   1. 垂直渐变（按深度段插值）
 *   2. 光柱（2–3 条，呼吸，越深越冷越淡）
 *   3. 气泡（10 档尺寸，上升，reduce-motion 下悬停）
 *   4. 小亮点（5 档尺寸，随深度变多、变暗，缓慢飘动）
 *
 * 硬约束：只动 opacity / transform；同时动画 ≤20；渲染失败不影响游戏。
 */
var DeepDiveBg = (function () {
  'use strict';

  /* ---------- 深度段色标 ---------- */
  var SKY = [
    { d: 1,   top: '#2e7d94', bottom: '#123a48' },
    { d: 25,  top: '#1d5a6e', bottom: '#0a222c' },
    { d: 50,  top: '#123f4f', bottom: '#061520' },
    { d: 75,  top: '#0a2836', bottom: '#030b12' },
    { d: 100, top: '#020508', bottom: '#000000' }
  ];

  /* 小亮点：数量 + 透明度随深度 */
  var SPARKS = [
    { from: 1,  to: 20,  n: [6, 10],  op: [0.18, 0.55] },
    { from: 21, to: 40,  n: [10, 15], op: [0.15, 0.50] },
    { from: 41, to: 60,  n: [15, 22], op: [0.12, 0.42] },
    { from: 61, to: 80,  n: [22, 30], op: [0.09, 0.34] },
    { from: 81, to: 100, n: [32, 44], op: [0.07, 0.26] }
  ];

  var BUBBLE_SIZES = [5, 8, 11, 14, 18, 23, 29, 36, 44, 54];
  var SPARK_SIZES = [5, 8, 11, 14, 18, 23, 29, 36, 44, 54];

  function skyFor(depth) {
    for (var i = 0; i < SKY.length - 1; i++) {
      if (depth <= SKY[i + 1].d) {
        var t = (depth - SKY[i].d) / (SKY[i + 1].d - SKY[i].d);
        return { top: mixHex(SKY[i].top, SKY[i + 1].top, t), bottom: mixHex(SKY[i].bottom, SKY[i + 1].bottom, t) };
      }
    }
    return { top: SKY[SKY.length - 1].top, bottom: SKY[SKY.length - 1].bottom };
  }
  function sparkSegFor(depth) {
    for (var i = 0; i < SPARKS.length; i++) {
      if (depth >= SPARKS[i].from && depth <= SPARKS[i].to) { return SPARKS[i]; }
    }
    return SPARKS[SPARKS.length - 1];
  }

  var BANDS = [
    { id: 1, from: 1, to: 10, bright: 1.00 },
    { id: 2, from: 11, to: 20, bright: 0.95 },
    { id: 3, from: 21, to: 30, bright: 0.85 },
    { id: 4, from: 31, to: 40, bright: 0.72 },
    { id: 5, from: 41, to: 50, bright: 0.58 },
    { id: 6, from: 51, to: 60, bright: 0.45 },
    { id: 7, from: 61, to: 70, bright: 0.34 },
    { id: 8, from: 71, to: 80, bright: 0.24 },
    { id: 9, from: 81, to: 90, bright: 0.16 },
    { id: 10, from: 91, to: 100, bright: 0.10 }
  ];
  function bandFor(depth) {
    for (var i = 0; i < BANDS.length; i++) {
      if (depth >= BANDS[i].from && depth <= BANDS[i].to) { return BANDS[i]; }
    }
    return BANDS[BANDS.length - 1];
  }

  function makeRng(seed) {
    var s = (seed >>> 0) || 0x9E3779B9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }
  function rgba(hex, a) {
    var h = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((h >> 16) & 255) + ',' + ((h >> 8) & 255) + ',' + (h & 255) + ',' + a + ')';
  }
  function mixHex(a, b, t) {
    var ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
    var ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
    var br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
    function h2(v) { var s = Math.round(v).toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + h2(ar + (br - ar) * t) + h2(ag + (bg - ag) * t) + h2(ab + (bb - ab) * t);
  }
  function el(tag, cls, style) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (style) { e.setAttribute('style', style); }
    return e;
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  /* 气泡边框透明度随深度衰减 */
  function bubbleFade(depth) {
    if (depth <= 20) { return 0.80; }
    if (depth <= 40) { return 0.65; }
    if (depth <= 60) { return 0.50; }
    if (depth <= 80) { return 0.38; }
    return 0.28;
  }

  /* ---------- 1. 垂直渐变 ---------- */
  function makeBase(depth) {
    var sky = skyFor(depth);
    var stops = [];
    for (var i = 0; i < 5; i++) {
      stops.push(mixHex(sky.top, sky.bottom, i / 4) + ' ' + (i * 25) + '%');
    }
    return el('div', 'bg-base', 'background: linear-gradient(180deg, ' + stops.join(', ') + ');');
  }

  /* ---------- 2. 光柱（v12 实现） ---------- */
  function makeShafts(depth, rng) {
    var band = bandFor(depth);
    var wrap = el('div', 'bg-shafts');
    var n = 2 + Math.floor(rng() * 2);
    var tilt = -14 + rng() * 8;
    var baseX = 16 + rng() * 40;
    for (var i = 0; i < n; i++) {
      var a = (band.id <= 2 ? 0.22 : 0.14) * band.bright;
      var shaft = el('i', 'bg-shaft', [
        'left:' + (baseX + i * (18 + rng() * 6)).toFixed(1) + '%',
        'top:' + (-20 + rng() * 6).toFixed(1) + '%',
        'width:' + (16 + rng() * 10).toFixed(1) + '%',
        'height:' + (120 + rng() * 15).toFixed(1) + '%',
        'transform: rotate(' + tilt.toFixed(1) + 'deg)',
        'background: linear-gradient(180deg, rgba(180,235,255,' + a.toFixed(3) + ') 0%, rgba(180,235,255,' + (a * 0.35).toFixed(3) + ') 55%, rgba(180,235,255,0) 100%)',
        '-webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 22%, #000 78%, transparent 100%)',
        'mask-image: linear-gradient(90deg, transparent 0%, #000 22%, #000 78%, transparent 100%)'
      ].join(';') + ';animation-duration:' + (8 + rng() * 4).toFixed(1) + 's;animation-delay:-' + (rng() * 12).toFixed(1) + 's');
      wrap.appendChild(shaft);
    }
    return wrap;
  }

  /* ---------- 3. 气泡 ---------- */
  function makeBubbles(depth, rng, animated) {
    var wrap = el('div', 'bg-bubbles');
    var n = 10 + Math.floor(rng() * 9);             /* 10-18 */
    var fade = bubbleFade(depth);
    var bandH = 844 / n;

    for (var i = 0; i < n; i++) {
      var size = pick(rng, BUBBLE_SIZES);
      var bw = Math.max(1.2, 0.8 + size / 54 * 0.7);
      var isAnim = i < animated;
      /* 纵向分层：第 i 个气泡落在第 i 条带，带内偏移 +/-30% */
      var top = (i + 0.5) * bandH + (rng() - 0.5) * 0.6 * bandH;
      var style = [
        'left:' + (10 + rng() * 370).toFixed(1) + 'px',
        'top:' + top.toFixed(1) + 'px',
        'width:' + size + 'px',
        'height:' + size + 'px',
        'border-width:' + bw.toFixed(2) + 'px',
        'border-color: rgba(111, 208, 224, ' + (0.80 * fade).toFixed(3) + ')'
      ];
      if (isAnim) {
        style.push('animation-duration:' + (18 + rng() * 72).toFixed(1) + 's');
        style.push('animation-delay:-' + (rng() * 30).toFixed(1) + 's');
      }
      wrap.appendChild(el('div', 'bg-bubble' + (isAnim ? '' : ' bg-bubble-static'), style.join(';')));
    }
    return wrap;
  }

  /* ---------- 4. 小亮点 ---------- */
  function makeSparks(depth, rng, animated) {
    var wrap = el('div', 'bg-sparks');
    var seg = sparkSegFor(depth);
    var n = seg.n[0] + Math.floor(rng() * (seg.n[1] - seg.n[0] + 1));
    var k = Math.min(1, (depth - 1) / 99);
    var color = mixHex('#8fd8e8', '#7a9bd0', k);
    var capN = depth <= 20 ? 10 : (depth <= 50 ? 7 : (depth <= 80 ? 5 : 4));
    var sizes = SPARK_SIZES.slice(0, capN);

    for (var i = 0; i < n; i++) {
      var size = pick(rng, sizes);
      var op = (seg.op[0] + rng() * (seg.op[1] - seg.op[0])).toFixed(2);
      var isAnim = i < animated;
      var style = [
        'left:' + (rng() * 388).toFixed(1) + 'px',
        'top:' + (rng() * 840).toFixed(1) + 'px',
        'width:' + size + 'px',
        'height:' + size + 'px',
        'opacity:' + op,
        '--sop:' + op,
        '--c:' + color
      ];
      if (isAnim) {
        var ang = rng() * Math.PI * 2;
        var dist = 40 + rng() * 40;
        style.push('--dx:' + (Math.cos(ang) * dist).toFixed(1) + 'px');
        style.push('--dy:' + (Math.sin(ang) * dist).toFixed(1) + 'px');
        style.push('animation-duration:' + (30 + rng() * 40).toFixed(1) + 's');
        style.push('animation-delay:-' + (rng() * 40).toFixed(1) + 's');
      }
      wrap.appendChild(el('i', 'bg-spark' + (isAnim ? '' : ' bg-spark-static'), style.join(';')));
    }
    return wrap;
  }

  function build(depth, seed, salt) {
    var mixed = (((seed >>> 0) ^ ((depth * 2654435761) >>> 0) ^ ((salt >>> 0) * 40503)) >>> 0);
    var rng = makeRng(mixed);

    var root = el('div', 'bg-scene');
    root.appendChild(makeBase(depth));
    root.appendChild(makeShafts(depth, rng));

    /* 同时动画 ≤20：光柱 ≤3 + 气泡 ≤12 + 亮点剩余额度 */
    var shaftN = root.querySelectorAll('.bg-shaft').length;
    var bubbles = makeBubbles(depth, rng, 12);
    var bubbleN = bubbles.children.length;
    var room = Math.max(0, 20 - shaftN - Math.min(bubbleN, 12));
    var sparks = makeSparks(depth, rng, room);
    root.appendChild(bubbles);
    root.appendChild(sparks);

    return { el: root, depth: depth, signature: 'v13|' + mixed };
  }

  function apply(depth, seed, salt) {
    var host = document.getElementById('bg-layer');
    if (!host) { return null; }
    try {
      var out = build(depth, seed, salt);
      host.innerHTML = '';
      host.appendChild(out.el);
      host.setAttribute('data-depth', String(depth));
      return out;
    } catch (e) {
      /* 背景失败绝不能影响游戏 */
      try {
        var seg = SKY[SKY.length - 1];
        host.innerHTML = '<div class="bg-scene"><div class="bg-base" style="background:linear-gradient(180deg,' +
          seg.top + ' 0%,' + seg.bottom + ' 100%)"></div></div>';
      } catch (e2) { /* ignore */ }
      return null;
    }
  }

  return { build: build, apply: apply, BUBBLE_SIZES: BUBBLE_SIZES, SPARK_SIZES: SPARK_SIZES };
})();
