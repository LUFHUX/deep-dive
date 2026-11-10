/*
 * 深潜 · 逻辑层自检（命令行版）
 *
 * 只给开发时用：node selftest-node.js
 * 游戏本体完全不依赖 Node，双击 index.html 就能玩。
 * 这个文件存在的唯一原因，是开发者看不见浏览器控制台时也能验证逻辑层。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ctx = vm.createContext({ console: console });
['logic.js', 'solver.js', 'generator.js', 'selftest.js'].forEach(function (f) {
  var code = fs.readFileSync(path.join(__dirname, f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
});

var out = vm.runInContext('DeepDiveTests.run()', ctx);

out.results.forEach(function (r) {
  var mark = r.ok ? 'PASS' : 'FAIL';
  var note = r.note ? '  — ' + r.note : '';
  console.log('[' + mark + '] ' + r.name + note);
});

console.log('');
console.log(out.passed + '/' + out.total + ' 通过' + (out.failed ? '，' + out.failed + ' 失败' : ''));
process.exit(out.failed ? 1 : 0);
