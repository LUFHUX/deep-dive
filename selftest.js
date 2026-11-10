/*
 * 深潜 · 逻辑层自检
 *
 * 两种跑法：
 *   1. 双击 selftest.html —— 在浏览器里看结果
 *   2. node selftest-node.js —— 命令行跑（只是开发时用，游戏本体不依赖 Node）
 *
 * 这里只测逻辑层。好不好玩、手感如何，测不出来，也不归这里管。
 */
var DeepDiveTests = (function () {
  'use strict';

  function run() {
    var L = DeepDiveLogic;
    var results = [];

    function check(name, fn) {
      try {
        var note = fn();
        results.push({ name: name, ok: true, note: note || '' });
      } catch (err) {
        results.push({ name: name, ok: false, note: (err && err.message) || String(err) });
      }
    }

    function assert(cond, msg) {
      if (!cond) { throw new Error(msg); }
    }

    function eq(a, b, msg) {
      if (a !== b) { throw new Error(msg + '（期望 ' + b + '，实际 ' + a + '）'); }
    }

    function countOf(state, kind) {
      var n = 0;
      for (var i = 0; i < state.board.cells.length; i++) {
        if (state.board.cells[i] === kind) { n++; }
      }
      return n;
    }

    function gameWith(seed, firstCell) {
      return L.createGame({ seed: seed, firstCell: firstCell == null ? 40 : firstCell });
    }

    function findSeed(pred, limit) {
      for (var s = 1; s <= (limit || 4000); s++) {
        if (pred(gameWith(s), s)) { return s; }
      }
      throw new Error('找不到满足条件的 seed');
    }

    function cellsIndexed(state, kind) {
      var out = [];
      for (var i = 0; i < state.board.cells.length; i++) {
        if (state.board.cells[i] === kind) { out.push(i); }
      }
      return out;
    }

    /* ---- 1. 棋盘构成 ---- */
    check('棋盘构成：每局恰好 10 暗礁 / 8 货箱 / 81 格', function () {
      for (var s = 1; s <= 200; s++) {
        var g = gameWith(s);
        eq(g.board.cells.length, 81, '第 ' + s + ' 局格子数');
        eq(countOf(g, L.MINE), 10, '第 ' + s + ' 局暗礁数');
        eq(countOf(g, L.CHEST), 8, '第 ' + s + ' 局货箱数');
      }
      return '扫了 200 局';
    });

    /* ---- 2. 棋盘是延迟生成的 ---- */
    check('延迟生成：没点之前不铺盘，点了才铺', function () {
      var g = L.createGame({ seed: 9 });
      assert(g.board === null, '未点击时 board 应为 null');
      var r = L.openCell(g, 40);
      assert(r.state.board !== null, '点击后应铺出棋盘');
      eq(countOf(r.state, L.MINE), 10, '铺盘后暗礁数');
      eq(countOf(r.state, L.CHEST), 8, '铺盘后货箱数');
      return '';
    });

    /* ---- 3. 首点周围 3×3 必空（v0.5.1 规则第 4 条） ---- */
    check('首点排除区：81 个位置 × 40 局，3×3 里没有特殊物', function () {
      var boards = 0;
      for (var s = 1; s <= 40; s++) {
        for (var c = 0; c < 81; c++) {
          var g = L.createGame({ seed: s * 31, firstCell: c });
          boards++;
          eq(g.board.cells[c], L.EMPTY, 'seed ' + s + ' 首点 ' + c + ' 自己不是空格');
          var nb = L.neighborsOf(9, 9, c);
          for (var k = 0; k < nb.length; k++) {
            eq(g.board.cells[nb[k]], L.EMPTY,
              'seed ' + s + ' 首点 ' + c + ' 的邻居 ' + nb[k] + ' 有特殊物');
          }
          eq(countOf(g, L.MINE), 10, 'seed ' + s + ' 首点 ' + c + ' 暗礁数');
          eq(countOf(g, L.CHEST), 8, 'seed ' + s + ' 首点 ' + c + ' 货箱数');
        }
      }
      return '铺了 ' + boards + ' 个盘';
    });

    /* ---- 4. 读数与暴力重算一致 ---- */
    check('读数：逐格与暴力重算一致', function () {
      for (var s = 1; s <= 120; s++) {
        var g = gameWith(s);
        for (var i = 0; i < 81; i++) {
          var r = g.readings[i];
          if (g.board.cells[i] !== L.EMPTY) {
            assert(r === null, '特殊格 ' + i + ' 不应有读数');
            continue;
          }
          var x = i % 9, y = Math.floor(i / 9), m = 0, c = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) { continue; }
              var nx = x + dx, ny = y + dy;
              if (nx < 0 || nx > 8 || ny < 0 || ny > 8) { continue; }
              var t = g.board.cells[ny * 9 + nx];
              if (t === L.MINE) { m++; } else if (t === L.CHEST) { c++; }
            }
          }
          eq(r.mine, m, '第 ' + s + ' 局格 ' + i + ' 暗礁数');
          eq(r.chest, c, '第 ' + s + ' 局格 ' + i + ' 货箱数');
          eq(r.total, m + c, '第 ' + s + ' 局格 ' + i + ' 总数');
        }
      }
      return '扫了 120 局';
    });

    /* ---- 5. 三色判定不变式 ---- */
    check('三色：blank / red / blue / mixed 互斥且完备', function () {
      var seen = {};
      for (var s = 1; s <= 120; s++) {
        var g = gameWith(s);
        for (var i = 0; i < 81; i++) {
          var r = g.readings[i];
          if (!r) { continue; }
          seen[r.color] = true;
          if (r.total === 0) {
            eq(r.color, L.BLANK, 'total=0 应为 blank');
          } else if (r.chest === 0) {
            eq(r.color, L.RED, '无货箱应为 red');
            assert(r.mine > 0, 'red 必有暗礁');
          } else if (r.mine === 0) {
            eq(r.color, L.BLUE, '无暗礁应为 blue');
            assert(r.chest > 0, 'blue 必有货箱');
          } else {
            eq(r.color, L.MIXED, '两者都有应为 mixed');
            assert(r.total >= 2, '紫格 N 必须 ≥ 2');
          }
        }
      }
      assert(seen.blank && seen.red && seen.blue && seen.mixed, '四种颜色都应出现过');
      return '四色齐全';
    });

    /* ---- 6. 确定性 ---- */
    check('确定性：同 seed + 同首点 = 同棋盘', function () {
      for (var s = 1; s <= 50; s++) {
        var a = gameWith(s, 40).board.cells.join(',');
        var b = gameWith(s, 40).board.cells.join(',');
        if (a !== b) { throw new Error('seed ' + s + ' 两局棋盘不同'); }
      }
      return '扫了 50 个 seed';
    });

    check('确定性：首点不同则棋盘不同', function () {
      var a = gameWith(7, 0).board.cells.join(',');
      var b = gameWith(7, 80).board.cells.join(',');
      assert(a !== b, '不同首点应该铺出不同棋盘');
      return 'seed 7：角 vs 角';
    });

    /* ---- 7. 首点必开一片空白 ---- */
    check('首点：必定是空白格，且至少翻开自己和全部邻居', function () {
      var trials = 0;
      for (var s = 1; s <= 100; s++) {
        for (var c = 0; c < 81; c++) {
          var g = L.createGame({ seed: s * 17, firstCell: c });
          var res = L.openCell(g, c);
          trials++;

          var st = res.state;
          eq(st.oxygen, 98, 'seed ' + s + ' 首点 ' + c + ' 掉了行动点（100-2）');
          eq(st.readings[c].total, 0, 'seed ' + s + ' 首点 ' + c + ' 的读数不是 0');

          var nb = L.neighborsOf(9, 9, c);
          var need = 1 + nb.length;
          var opened = 0;
          for (var k = 0; k < 81; k++) { if (st.open[k] !== L.HIDDEN) { opened++; } }
          assert(opened >= need,
            'seed ' + s + ' 首点 ' + c + ' 只翻开了 ' + opened + ' 格，至少要有 ' + need);

          for (var j = 0; j < 81; j++) {
            if (st.open[j] !== L.HIDDEN) {
              assert(st.board.cells[j] === L.EMPTY, '首点翻出了特殊物 ' + j);
            }
          }
        }
      }
      return '试了 ' + trials + ' 次首点';
    });

    /* ---- 8. 连锁展开 ---- */
    check('连锁展开：绝不翻出暗礁或货箱', function () {
      var opened = 0;
      for (var s = 1; s <= 120; s++) {
        var g = gameWith(s);
        var target = -1;
        for (var i = 0; i < 81; i++) {
          if (g.readings[i] && g.readings[i].total === 0) { target = i; break; }
        }
        if (target < 0) { continue; }
        var res = L.openCell(g, target);
        opened++;
        for (var k = 0; k < 81; k++) {
          if (res.state.open[k] !== L.HIDDEN) {
            assert(res.state.board.cells[k] === L.EMPTY,
              '第 ' + s + ' 局连锁翻出了特殊物 ' + k);
          }
        }
        eq(res.state.collected, 0, '第 ' + s + ' 局连锁不该捞到货箱');
        eq(res.state.sunk, 0, '第 ' + s + ' 局连锁不该撞礁');
      }
      return '测了 ' + opened + ' 局';
    });

    /* ---- 9. 撞暗礁 ---- */
    check('撞暗礁：掉 12 氧（点击 2 + 撞击 10），只翻这一格', function () {
      var seed = findSeed(function (g) {
        return cellsIndexed(g, L.MINE).length === 10 && cellsIndexed(g, L.EMPTY).length > 0;
      });
      var g = gameWith(seed);
      var safe = cellsIndexed(g, L.EMPTY)[0];
      var mine = cellsIndexed(g, L.MINE)[0];

      var r1 = L.openCell(g, safe);
      var before = 0;
      for (var k = 0; k < 81; k++) { if (r1.state.open[k] !== L.HIDDEN) { before++; } }

      /* 首点已经用掉了，这里再点暗礁 */
      if (r1.state.board.cells[mine] !== L.MINE) { throw new Error('构造失败'); }
      var r2 = L.openCell(r1.state, mine);
      var after = 0;
      for (var j = 0; j < 81; j++) { if (r2.state.open[j] !== L.HIDDEN) { after++; } }

      eq(r2.state.open[mine], L.OPEN_MINE, '该格应为已撞暗礁');
      eq(r2.state.oxygen, 86, '氧气（首点 -2，撞礁 -12）');
      eq(L.remainingMines(r2.state), 9, '剩余暗礁');
      eq(after - before, 1, '撞礁只应翻开一格');
      eq(r2.state.readings[mine], null, '撞礁格不应有读数');
      return 'seed ' + seed;
    });

    /* ---- 10. 货箱 ---- */
    check('货箱：捞起即推进配额，不掉氧', function () {
      var g = gameWith(1);
      var chest = cellsIndexed(g, L.CHEST)[0];
      var res = L.openCell(g, chest);
      eq(res.state.open[chest], L.OPEN_CHEST, '该格应为已捞货箱');
      eq(res.state.collected, 1, '已捞数');
      eq(L.remainingChests(res.state), 7, '剩余货箱');
      var chestEv = null;
      for (var e2 = 0; e2 < res.events.length; e2++) { if (res.events[e2].type === 'chest') { chestEv = res.events[e2]; } }
      assert(chestEv && chestEv.gained > 0, '开箱应当有回氧');
      eq(res.state.oxygen, Math.min(100, 98 + chestEv.gained), '点击 -2，开箱 +' + chestEv.gained + '（上限 100）');
      return 'seed 1';
    });

    /* ---- 11. 通关不结束（v20：通关 = 打开门） ---- */
    check('通关：打开门只记通关，游戏继续', function () {
      var g = gameWith(1);
      var chests = cellsIndexed(g, L.CHEST);
      var cur = g;
      var sawCleared = false;
      var sawDoor = false;
      for (var k = 0; k < chests.length; k++) {
        var res = L.openCell(cur, chests[k]);
        cur = res.state;
        for (var e = 0; e < res.events.length; e++) {
          if (res.events[e].type === 'cleared') { sawCleared = true; }
          if (res.events[e].type === 'door') { sawDoor = true; }
        }
        eq(cur.status, L.PLAYING, '第 ' + (k + 1) + ' 个瓶子后仍应进行中');
      }
      assert(sawDoor, '应发出 door 事件');
      assert(sawCleared, '应发出一次 cleared 事件');
      eq(cur.cleared, true, '门开后应置通关标记');
      eq(cur.collected, chests.length - 1, '门外每瓶算一次收集');
      return 'seed 1';
    });

    /* ---- 12. 氧气耗尽才结束 ---- */
    check('结束：氧气耗尽才结束，且不判定失败', function () {
      var g = gameWith(1);
      var safe = cellsIndexed(g, L.EMPTY)[0];
      var mines = cellsIndexed(g, L.MINE);
      var cur = L.openCell(g, safe).state;
      /* v11：氧气是行动点，撞到付不起下一次才结束。一直撞，直到状态变成 ended。 */
      var sawEnd = false;
      var hits = 0;
      for (var k = 0; k < mines.length && cur.status === L.PLAYING; k++) {
        var res = L.openCell(cur, mines[k]);
        cur = res.state;
        hits++;
        for (var e = 0; e < res.events.length; e++) {
          if (res.events[e].type === 'end') { sawEnd = true; }
        }
      }
      assert(sawEnd, '应发出 end 事件');
      assert(cur.oxygen < cur.cfg.stepCost, '结束时氧气应已付不起下一手（剩 ' + cur.oxygen + '）');
      assert(hits > 1, '不该撞一次就结束（撞了 ' + hits + ' 次）');
      eq(cur.status, L.ENDED, '付不起下一手后应结束');
      eq(cur.cleared, false, '没达标就没有通关标记');
      return 'seed 1';
    });

    /* ---- 12b. 通关后仍然耗氧，耗尽了奖励全保留 ---- */
    check('通关后：氧气照常消耗，耗尽时奖励全部保留', function () {
      var g = gameWith(1);
      var chests = cellsIndexed(g, L.CHEST);
      var mines = cellsIndexed(g, L.MINE);
      var cur = g;
      for (var k = 0; k < chests.length; k++) { cur = L.openCell(cur, chests[k]).state; }
      eq(cur.cleared, true, '应已通关（门已开）');

      var oxyBeforeMine = cur.oxygen;
      cur = L.openCell(cur, mines[0]).state;
      eq(cur.status, L.PLAYING, '通关后撞一次不该结束');
      eq(cur.oxygen, oxyBeforeMine - 12, '撞一次只扣 12（点击 2 + 撞击 10），货箱回氧不封顶');

      /*
       * v11 加了货箱回氧，撞满所有暗礁也未必耗尽 —— 所以这里不再断言「一定结束」，
       * 只验「继续打捞不会吃掉已经拿到的东西」。耗尽判定由第 12 条单独覆盖。
       */
      for (var m = 1; m < mines.length && cur.status === L.PLAYING; m++) { cur = L.openCell(cur, mines[m]).state; }
      assert(cur.oxygen >= 0, '氧气不该为负');
      eq(cur.collected, chests.length - 1, '已捞的货箱全部保留');
      eq(cur.cleared, true, '通关标记保留');
      return 'seed 1';
    });

    /* ---- 12c. 全开即结束（ROADMAP Round 1 第 1 条） ---- */
    check('全开：所有非暗礁格翻开后立刻结束', function () {
      var cur = gameWith(1);
      var opened = 0;
      for (var i = 0; i < 81 && cur.status === L.PLAYING; i++) {
        if (cur.board.cells[i] === L.MINE) { continue; }
        var res = L.openCell(cur, i);
        if (res.events.length === 1 && res.events[0].type === 'noop') { continue; }
        cur = res.state;
        opened++;
        if (cur.perfect) {
          var sawPerfect = false;
          for (var e = 0; e < res.events.length; e++) {
            if (res.events[e].type === 'perfect') { sawPerfect = true; }
          }
          assert(sawPerfect, '应发出 perfect 事件');
        }
      }
      eq(cur.status, L.ENDED, '全开后应结束');
      eq(cur.perfect, true, 'perfect 标记');
      assert(opened > 0, '至少要开过格子');
      for (var k = 0; k < 81; k++) {
        if (cur.board.cells[k] !== L.MINE) {
          assert(cur.open[k] !== L.HIDDEN, '还有非暗礁格没翻开：' + k);
        }
      }
      return '开了 ' + opened + ' 步';
    });

    check('全开：不是暗礁也还没全开时，不该提前结束', function () {
      var cur = gameWith(1);
      var res = L.openCell(cur, 40);
      cur = res.state;
      eq(cur.perfect, false, '刚开局不该 perfect');
      eq(cur.status, L.PLAYING, '刚开局不该结束');
      return '';
    });
    check('幂等：重复点同一格不改变任何状态', function () {
      var g = gameWith(1);
      var target = cellsIndexed(g, L.EMPTY)[0];
      var a = L.openCell(g, target).state;
      var b = L.openCell(a, target);
      eq(b.events[0].type, 'noop', '第二次点击应为 noop');
      eq(b.state.moves, a.moves, '步数');
      eq(b.state.oxygen, a.oxygen, '氧气');
      eq(b.state.open.join(','), a.open.join(','), '翻开状态');
    });

    /* ---- 14. 结束后无效 ---- */
    check('结束后：点击和标记都不再改变状态', function () {
      var g = gameWith(1);
      var safe = cellsIndexed(g, L.EMPTY)[0];
      var mines = cellsIndexed(g, L.MINE);
      var cur = L.openCell(g, safe).state;
      for (var k = 0; k < mines.length && cur.status === L.PLAYING; k++) { cur = L.openCell(cur, mines[k]).state; }
      eq(cur.status, L.ENDED, '应已结束');

      var res = L.openCell(cur, 0);
      eq(res.events[0].type, 'noop', '结束后点击应为 noop');
      eq(res.state.moves, cur.moves, '步数不应变');

      var mk = L.toggleMark(cur, 0);
      eq(mk.events[0].type, 'noop', '结束后标记应为 noop');
      eq(L.markedCount(mk.state), 0, '结束后不该产生标记');
    });

    /* ---- 15. 计数器 ---- */
    check('计数器：整局任意时刻不为负', function () {
      for (var s = 1; s <= 60; s++) {
        var cur = gameWith(s);
        var step = 0;
        while (cur.status === L.PLAYING && step < 81) {
          var idx = (step * 17 + s * 7) % 81;
          cur = L.openCell(cur, idx).state;
          assert(L.remainingMines(cur) >= 0, 'seed ' + s + ' 剩余暗礁为负');
          assert(L.remainingChests(cur) >= 0, 'seed ' + s + ' 剩余货箱为负');
          assert(cur.oxygen >= 0, 'seed ' + s + ' 氧气为负');
          assert(cur.oxygen >= 0, 'seed ' + s + ' 氧气为负');
          step++;
        }
      }
      return '扫了 60 局乱点';
    });

    /* ---- 16. 标记：两态开关 ---- */
    check('标记：开关是两态，不是循环', function () {
      var g = gameWith(1);
      var hidden = -1;
      for (var i = 0; i < 81; i++) { if (g.open[i] === L.HIDDEN) { hidden = i; break; } }

      var a = L.toggleMark(g, hidden);
      eq(a.state.marks[hidden], true, '第一次应为开');
      eq(a.events[0].type, 'mark', '应产生 mark 事件');
      eq(a.events[0].on, true, '事件应为开');

      var b = L.toggleMark(a.state, hidden);
      eq(b.state.marks[hidden], false, '第二次应为关');
      eq(b.events[0].on, false, '事件应为关');

      var c = L.toggleMark(b.state, hidden);
      eq(c.state.marks[hidden], true, '第三次回到开');
      return '三下回到开';
    });

    /* ---- 17. 标记：纯辅助，不动任何东西 ---- */
    check('标记：不改变计数、棋盘、步数、氧气', function () {
      var g = gameWith(1);
      var a = L.toggleMark(g, 3);
      eq(a.state.board, g.board, '棋盘引用不该变');
      eq(a.state.readings, g.readings, '读数引用不该变');
      eq(L.remainingMines(a.state), L.remainingMines(g), '剩余暗礁不该变');
      eq(L.remainingChests(a.state), L.remainingChests(g), '剩余货箱不该变');
      eq(a.state.oxygen, g.oxygen, '氧气不该变');
      eq(a.state.collected, g.collected, '已捞数不该变');
      eq(a.state.moves, g.moves, '步数不该变（标记不算一手）');
      eq(a.state.status, L.PLAYING, '状态不该变');
      eq(a.state.open[3], L.HIDDEN, '标记不该翻开格子');
      return '';
    });

    /* ---- 18. 标记：左键仍能翻开 ---- */
    check('标记：左键点已标记的格子照常翻开', function () {
      var g = gameWith(1);
      var mine = cellsIndexed(g, L.MINE)[0];
      var marked = L.toggleMark(g, mine).state;
      eq(marked.marks[mine], true, '前置条件：已标记');

      var res = L.openCell(marked, mine);
      eq(res.state.open[mine], L.OPEN_MINE, '应该照常撞礁翻开');
      eq(res.state.marks[mine], false, '翻开后标记应被清掉');
      eq(res.state.sunk, 1, '应计入撞礁');
      return '';
    });

    /* ---- 19. 标记：已翻开的不能标 ---- */
    check('标记：已翻开的格子不能标记', function () {
      var g = gameWith(1);
      var res = L.openCell(g, 40);
      var opened = 40;
      assert(res.state.open[opened] === L.OPEN_SAFE, '前提：该格已翻开');
      var mk = L.toggleMark(res.state, opened);
      eq(mk.events[0].type, 'noop', '应被拒绝');
      eq(mk.state.marks[opened], false, '不该标上');
      return '';
    });

    /* ---- 20. 标记：连锁展开时清掉区域内的标记 ---- */
    check('标记：被连锁展开吞掉的标记会清除', function () {
      var g = gameWith(1);
      var target = -1;
      for (var i = 0; i < 81; i++) {
        if (g.readings[i] && g.readings[i].total === 0) { target = i; break; }
      }
      if (target < 0) { return '该局无空白格，跳过'; }
      var marked = L.toggleMark(g, target).state;
      eq(marked.marks[target], true, '前置条件：已标记');

      var res = L.openCell(marked, target);
      eq(res.state.marks[target], false, '被展开后标记应清掉');
      eq(res.state.open[target], L.OPEN_SAFE, '应该翻开');
      return '';
    });

    /* ---- 21. 生成闸门（需要 solver.js + generator.js） ---- */
    var hasGate = (typeof DeepDiveGenerator !== 'undefined') && (typeof DeepDiveSolver !== 'undefined');

    check('闸门：过闸的棋盘必然可解（30 局独立复验）', function () {
      if (!hasGate) { return '未加载 generator/solver，跳过'; }
      var G = DeepDiveGenerator;
      var S = DeepDiveSolver;
      var bad = 0;
      for (var s = 1; s <= 30; s++) {
        var seed = s * 7919;
        var first = (s * 37) % 81;
        var base = L.createGame({ seed: seed });
        var gated = G.ensureSolvable(base, first, { maxAttempts: 200 });
        /* 独立复验：不看闸门结论，自己再解一遍 */
        var opened = L.openCell(gated.state, first);
        var res = S.solve(opened.state, { budget: 120000, mode: 'strict' });
        if (!res.solvable) { bad++; }
      }
      eq(bad, 0, '复验失败的局数');
      return '30/30 可解';
    });

    check('闸门：同 seed + 同首点得到同一块棋盘', function () {
      if (!hasGate) { return '未加载 generator/solver，跳过'; }
      var G = DeepDiveGenerator;
      for (var s = 1; s <= 10; s++) {
        var a = G.ensureSolvable(L.createGame({ seed: s * 131 }), 40, {}).state;
        var b = G.ensureSolvable(L.createGame({ seed: s * 131 }), 40, {}).state;
        eq(a.seed, b.seed, 'seed ' + s + ' 最终 seed');
        eq(a.board.cells.join(','), b.board.cells.join(','), 'seed ' + s + ' 棋盘');
      }
      return '10 个 seed 全部一致';
    });

    check('闸门：上限耗尽时抛 GATE_EXHAUSTED，不静默卡死', function () {
      if (!hasGate) { return '未加载 generator/solver，跳过'; }
      var G = DeepDiveGenerator;
      var thrown = null;
      for (var s = 1; s <= 300 && !thrown; s++) {
        try {
          G.ensureSolvable(L.createGame({ seed: s }), (s * 37) % 81, { maxAttempts: 1 });
        } catch (e) { thrown = e; }
      }
      assert(thrown, '应该抛错，但一路静默通过了');
      eq(thrown.code, 'GATE_EXHAUSTED', '错误码');
      return '第 ' + s + ' 个 seed 触发';
    });

    /* ---- 13. 幂等 ---- */
    var failed = 0;
    for (var i = 0; i < results.length; i++) { if (!results[i].ok) { failed++; } }
    return { results: results, passed: results.length - failed, failed: failed, total: results.length };
  }

  return { run: run };
})();






