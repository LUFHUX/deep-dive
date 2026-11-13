/*
 * 深潜 · 音效（v2，2026-11-13）
 *
 * 8 个 mp3 在 proto/audio/，每个一个 Audio 对象，预加载。
 * - 播放前 currentTime = 0（快速连点可重复触发）
 * - 音量 = 10^(dB/20)
 * - play() 的 Promise 必须 catch（自动播放策略会拒绝，静默失败）
 * - 教学关（body.tut-on）不播
 *
 * 微信小游戏：这里换成 wx.createInnerAudioContext()
 * 每个音效一个实例，src 用同样的路径。
 * 注意小游戏首次播放需要用户手势之后才允许。
 */
window.DeepDiveAudio = (function () {
  'use strict';

  var BASE = 'audio/';
  var FILES = {
    open: 'sfx-open.mp3',
    bottle: 'sfx-bottle.mp3',
    mine: 'sfx-mine.mp3',
    reveal: 'sfx-reveal.mp3',
    dive: 'sfx-dive.mp3',
    win: 'sfx-win.mp3',
    'win-perfect': 'sfx-win-perfect.mp3',
    lose: 'sfx-lose.mp3'
  };
  var VOL = {
    open: -18, bottle: -12, mine: -8, reveal: -12,
    dive: -14, win: -12, 'win-perfect': -10, lose: -12
  };

  var pool = {};
  var enabled = true;
  var loaded = false;

  function gainFor(db) {
    var g = Math.pow(10, db / 20);
    return Math.max(0, Math.min(1, g));
  }

  /* 微信小游戏：见文件头注释，改这里 */
  function preload() {
    if (loaded) { return; }
    loaded = true;
    try {
      Object.keys(FILES).forEach(function (name) {
        var a = new window.Audio(BASE + FILES[name]);
        a.preload = 'auto';
        a.volume = gainFor(VOL[name]);
        pool[name] = a;
      });
    } catch (e) { /* 没有 Audio 也不能影响游戏 */ }
  }

  function isTutorial() {
    try {
      return !!(document.body && document.body.classList && document.body.classList.contains('tut-on'));
    } catch (e) { return false; }
  }

  function play(name) {
    if (!enabled || isTutorial()) { return; }
    var a = pool[name];
    if (!a) { return; }
    try {
      a.currentTime = 0;
      var p = a.play();
      if (p && p.catch) { p.catch(function () { /* 自动播放被拒，静默 */ }); }
    } catch (e) { /* 播放失败不影响游戏 */ }
  }

  /* iOS Safari：手势之外创建的 Audio，之后 play() 可能被拒；
   * 第一次触摸/点击时把所有音效 load() 一遍，解锁播放。 */
  function unlock() {
    Object.keys(pool).forEach(function (k) {
      try { pool[k].load(); } catch (e) {}
    });
  }

  function setEnabled(on) {
    enabled = !!on;
  }
  function isEnabled() { return enabled; }

  var api = { play: play, preload: preload, setEnabled: setEnabled, enabled: isEnabled, unlock: unlock };
  /* 调试页（?debug=1）才暴露实例，方便自动化验证；正常游戏不用 */
  try {
    if (window.location && String(window.location.search).indexOf('debug=1') >= 0) { api._pool = pool; }
  } catch (e) {}
  return api;
})();
