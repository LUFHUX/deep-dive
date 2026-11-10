/*
 * 深潜 · 形态判定（v19）
 *
 * A 型（模糊）：紫比例 ≥ 该尺寸的 p75
 * B 型（荒芜）：空白格比例 ≥ 该尺寸的 p75
 * C 型（凶相）：最大读数 ≥ 5
 *
 * 阈值来自 `proto/calib.js`（按尺寸标定，不硬编码 9×9 的值）。
 */
var DeepDiveShape = (function () {
  'use strict';

  function metrics(state) {
    var rd = state.readings;
    if (!rd) { return null; }
    var colored = 0, mixed = 0, blank = 0, maxRead = 0;
    for (var i = 0; i < rd.length; i++) {
      if (!rd[i]) { continue; }
      if (rd[i].total === 0) { blank++; } else { colored++; }
      if (rd[i].total > maxRead) { maxRead = rd[i].total; }
      if (rd[i].mine > 0 && rd[i].chest > 0) { mixed++; }
    }
    return {
      purple: colored ? mixed / colored : 0,
      blank: blank / rd.length,
      maxRead: maxRead
    };
  }

  function calibFor(cols, rows) {
    var key = cols + 'x' + rows;
    if (typeof DeepDiveCalib !== 'undefined' && DeepDiveCalib[key]) { return DeepDiveCalib[key]; }
    /* 没标定过的尺寸：用 9×9 的值兜底，并在控制台留一句 */
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[shape] 未标定尺寸 ' + key + '，退回 9×9 阈值');
    }
    return { purpleP75: 0.412, blankP75: 0.185 };
  }

  /* shape: 'A' | 'B' | 'C' | null */
  function hit(shape, m, cols, rows) {
    if (!shape) { return true; }
    if (!m) { return false; }
    var cal = calibFor(cols, rows);
    if (shape === 'A') { return m.purple >= cal.purpleP75; }
    if (shape === 'B') { return m.blank >= cal.blankP75; }
    if (shape === 'C') { return m.maxRead >= 5; }
    return true;
  }

  return {
    metrics: metrics,
    hit: hit,
    calibFor: calibFor
  };
})();
