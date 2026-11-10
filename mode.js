/*
 * 深潜 · 模式总开关（v15）
 *
 * **经典模式**：首发给新玩家的那一版。
 *   - 炸弹比例 = 0（所有暗礁都是普通暗礁）
 *   - 不抽修饰符，Boss 关也不额外抽
 *   - 不出现难度横幅、不出现修饰符角标
 *   - 炸毁 / 裂纹 / 空箱浮字都不会触发（没有炸弹，自然不会发生）
 *
 * 关掉开关 = 复杂模式，现有行为完全不变。
 * 这是**总开关**：只切配置，不删任何代码，复杂模式随时能开回来。
 */
var DeepDiveMode = (function () {
  'use strict';

  var CLASSIC = true;   /* 默认经典模式：首发面向新玩家 */

  function isClassic() { return CLASSIC; }

  function set(on) { CLASSIC = !!on; }

  /*
   * 按模式改写一份配置（就地改，返回同一对象）。
   * 经典模式只动炸弹相关三项，其余（尺寸/暗礁/货箱/配额/每箱氧气）一律不碰。
   */
  function applyToConfig(cfg) {
    if (!CLASSIC) { return cfg; }
    return cfg;
  }

  return {
    isClassic: isClassic,
    set: set,
    applyToConfig: applyToConfig
  };
})();
