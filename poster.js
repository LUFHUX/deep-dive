/*
 * 分享海报：canvas 2D 手工绘制 750×1334（2 倍图）。
 * 不引任何外部库；不截 DOM。
 *
 * 拆成两个函数：
 *   buildPoster(run, records, skin) -> canvas   （纯绘制，可在任何端复用）
 *   savePoster(canvas)                          （端相关：浏览器下载 / 微信保存相册）
 */
(function (global) {
  'use strict';

  var W = 750;
  var H = 1334;
  var FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

  function fmtNum(n) {
    var s = String(Math.round(n || 0));
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) { out += ','; }
      out += s.charAt(i);
    }
    return out;
  }

  function fmtDur(ms) {
    var s = Math.max(0, Math.round((ms || 0) / 1000));
    if (s >= 3600) { return Math.floor(s / 3600) + ' 小时 ' + Math.floor((s % 3600) / 60) + ' 分'; }
    if (s >= 60) { return Math.floor(s / 60) + ' 分'; }
    return s + ' 秒';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function buildPoster(run, records, skin) {
    run = run || {};
    records = records || {};
    var win = skin === 'win';

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    /* ---------- 背景：深海径向渐变 ---------- */
    var bg = ctx.createRadialGradient(W / 2, H * 0.36, 60, W / 2, H * 0.42, H * 0.82);
    if (win) {
      bg.addColorStop(0, '#18405c');
      bg.addColorStop(0.55, '#0b2233');
      bg.addColorStop(1, '#04101a');
    } else {
      bg.addColorStop(0, '#12283a');
      bg.addColorStop(0.55, '#091a27');
      bg.addColorStop(1, '#030b12');
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    /* ---------- 顶部小字 ---------- */
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(180, 220, 245, .75)';
    ctx.font = '500 28px ' + FONT;
    ctx.fillText('《深潜》', W / 2, 118);

    /* 模式标签：单独一行，不和《深潜》拼字符串 */
    ctx.fillStyle = 'rgba(180, 220, 245, .55)';
    ctx.font = '500 22px ' + FONT;
    ctx.fillText('经典模式', W / 2, 152);

    /* ---------- 主标题 ---------- */
    ctx.fillStyle = win ? '#ffd86b' : '#eaf6ff';
    ctx.font = 'bold 62px ' + FONT;
    var title = win ? '你潜到了海底！' : ('你停在了第 ' + (run.depth || 1) + ' 层');
    ctx.fillText(title, W / 2, win ? 250 : 250);

    /* ---------- 徽章（perfect 优先；否则零撞礁） ---------- */
    var badgeY = 318;
    var hintsUsed = 3 - (typeof run.hintsLeft === 'number' ? run.hintsLeft : 3);
    var badgeKind = !win ? null : ((run.hits || 0) !== 0 ? null : ((hintsUsed === 0 && (run.adsWatched || 0) === 0) ? 'perfect' : 'clean'));
    if (badgeKind) {
      var text = badgeKind === 'perfect' ? '完美推理' : '零撞礁';
      ctx.font = 'bold ' + (badgeKind === 'perfect' ? 30 : 26) + 'px ' + FONT;
      var tw = ctx.measureText(text).width;
      var bw = tw + 68;
      var bh = 62;
      roundRect(ctx, W / 2 - bw / 2, badgeY, bw, bh, 31);
      var bg2 = ctx.createLinearGradient(0, badgeY, 0, badgeY + bh);
      if (badgeKind === 'perfect') { bg2.addColorStop(0, '#ffe28a'); bg2.addColorStop(1, '#f5b93c'); }
      else { bg2.addColorStop(0, '#cfe9f6'); bg2.addColorStop(1, '#9fc4d8'); }
      ctx.fillStyle = bg2;
      ctx.fill();
      ctx.fillStyle = badgeKind === 'perfect' ? '#201603' : '#07202e';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, W / 2, badgeY + bh / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }

    /* ---------- 数据区 ---------- */
    var rows = win
      ? [
          ['通关时长', fmtDur(run.activeMs)],
          ['翻开格子', fmtNum(run.cellsOpened) + ' 格'],
          ['氧气瓶', fmtNum(run.totalCollected) + ' 个'],
          ['撞礁', fmtNum(run.hits) + ' 次']
        ]
      : [
          ['下潜时长', fmtDur(run.activeMs)],
          ['停在', '第 ' + (run.depth || 1) + ' 层'],
          ['翻开格子', fmtNum(run.cellsOpened) + ' 格'],
          ['氧气瓶', fmtNum(run.totalCollected) + ' 个']
        ];

    var panelX = 90;
    var panelW = W - panelX * 2;
    var rowH = 104;
    var panelY = win ? 470 : 430;
    var panelH = rows.length * rowH + 56;

    roundRect(ctx, panelX, panelY, panelW, panelH, 28);
    ctx.fillStyle = 'rgba(8, 24, 38, .55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 200, 240, .18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (var i = 0; i < rows.length; i++) {
      var y = panelY + 28 + i * rowH;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(155, 195, 215, .95)';
      ctx.font = '500 32px ' + FONT;
      ctx.fillText(rows[i][0], panelX + 44, y + 50);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#eaf6ff';
      ctx.font = 'bold 36px ' + FONT;
      ctx.fillText(rows[i][1], panelX + panelW - 44, y + 50);
    }

    /* ---------- 标语（数据卡下方 90px） ---------- */
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 216, 107, .75)';
    ctx.font = '500 27px ' + FONT;
    ctx.fillText('100 层海床，每一格都有答案。', W / 2, panelY + panelH + 90);

    /* ---------- 底部：海底编号 ---------- */
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(140, 175, 195, .7)';
    ctx.font = '400 26px ' + FONT;
    ctx.fillText('海底编号 #' + String(run.seed || 0), W / 2, H - 96);

    /* ---------- 右下角：二维码位（留白 + 注释） ---------- */
    var qrSize = 170;
    var qrX = W - qrSize - 48;
    var qrY = H - qrSize - 48;
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(140, 190, 220, .28)';
    ctx.lineWidth = 2;
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 16);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(140, 190, 220, .38)';
    ctx.font = '400 20px ' + FONT;
    ctx.fillText('二维码位', qrX + qrSize / 2, qrY + qrSize / 2 + 7);

    return canvas;
  }

  /* ---------- 保存 ---------- */
  function toast(text) {
    var el = document.getElementById('poster-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'poster-toast';
      el.className = 'poster-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    window.clearTimeout(el._t);
    el._t = window.setTimeout(function () { el.classList.remove('show'); }, 2000);
  }

  function savePoster(canvas, filename) {
    /* 浏览器版：canvas → blob → <a download> */
    try {
      var url = canvas.toDataURL('image/png');
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || '深潜.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('已保存');
    } catch (e) {
      toast('保存失败');
      if (window.console) { console.error('[POSTER] 保存失败', e); }
    }

    /*
     * 微信小游戏版（以后换这里，其它代码不动）：
     *   1. wx.canvasToTempFilePath({ canvas: canvas, fileType: 'png',
     *        success: function (res) {
     *          wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath,
     *            success: function () { toast('已保存'); },
     *            fail: function () { toast('保存失败'); } });
     *        }});
     *   2. 需要在 wx 后台申请「保存到相册」权限；真机首次会弹授权。
     *   3. 没有 wx API 时（H5）才走上面的 <a download>。
     */
  }

  global.DeepDivePoster = {
    buildPoster: buildPoster,
    savePoster: savePoster,
    W: W,
    H: H
  };
})(window);
