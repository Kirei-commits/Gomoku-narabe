/**
 * render.js — Canvas 2D による盤面描画とエフェクト
 * 常時 requestAnimationFrame でループし、着手時の衝撃波・粒子・勝利ラインを演出する。
 */
(function (global) {
  'use strict';

  var B = global.CG.Board;
  var N = B.SIZE;

  var COLORS = {
    p1:      '#00e5ff',
    p1Light: '#c8fbff',
    p1Dark:  '#023d4a',
    p2:      '#ff2fd0',
    p2Light: '#ffd0f5',
    p2Dark:  '#4d0a41',
    grid:    'rgba(0, 229, 255, 0.26)',
    gridHot: 'rgba(0, 229, 255, 0.42)',
    star:    'rgba(0, 229, 255, 0.55)',
    bg0:     '#050a16',
    bg1:     '#020408'
  };

  function palette(player) {
    return player === B.P1
      ? { main: COLORS.p1, light: COLORS.p1Light, dark: COLORS.p1Dark }
      : { main: COLORS.p2, light: COLORS.p2Light, dark: COLORS.p2Dark };
  }

  function now() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.board = B.create();
    this.size = 0; this.cell = 0; this.margin = 0; this.dpr = 1;

    this.hover = null;        // {x,y,player}
    this.pending = null;      // タップ確認モードで選択中のマス {x,y,player}
    this.hint = null;         // ヒントの推奨手 {x,y}
    this.mate = null;         // 詰み筋 [{x,y,player}]
    this.forbidden = null;    // 禁じ手の点 [[x,y], ...]
    this.mateStep = -1;       // 詰み筋のうち強調する手のindex
    this.lastMove = null;     // {x,y,player}
    this.winLine = null;      // [[x,y], ...]
    this.winAt = 0;
    this.anims = {};          // idx -> 着手アニメの開始時刻
    this.ripples = [];
    this.particles = [];
    this.reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this._raf = null;
    this._boundLoop = this._loop.bind(this);

    this.resize();
    var self = this;
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self.resize(); });
      this._ro.observe(canvas);
    } else {
      global.addEventListener('resize', function () { self.resize(); });
    }
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.hidden) self.stop(); else self.start();
    });
  }

  /* --- 座標変換 ----------------------------------------------------- */
  Renderer.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var css = Math.max(120, Math.min(rect.width, rect.height) || rect.width);
    this.dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    this.size = css;
    this.canvas.width = Math.round(css * this.dpr);
    this.canvas.height = Math.round(css * this.dpr);
    this.cell = css / (N + 1);
    this.margin = this.cell;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  Renderer.prototype.px = function (i) { return this.margin + i * this.cell; };

  /**
   * クライアント座標 → 最寄りのマス（範囲外なら null）。
   * tolerance はマス幅に対する許容半径。指での操作では大きめの値を渡す。
   */
  Renderer.prototype.cellAt = function (clientX, clientY, tolerance) {
    var rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return null;
    var scale = this.size / rect.width;
    var lx = (clientX - rect.left) * scale;
    var ly = (clientY - rect.top) * scale;
    var x = Math.round((lx - this.margin) / this.cell);
    var y = Math.round((ly - this.margin) / this.cell);
    x = Math.max(0, Math.min(N - 1, x));
    y = Math.max(0, Math.min(N - 1, y));
    var tol = (tolerance || 0.62) * this.cell;
    var dx = lx - this.px(x), dy = ly - this.px(y);
    if (Math.sqrt(dx * dx + dy * dy) > tol) return null;
    return { x: x, y: y };
  };

  /* --- 状態更新 ----------------------------------------------------- */
  Renderer.prototype.setBoard = function (board) { this.board = board; };

  Renderer.prototype.markPlaced = function (x, y, player) {
    this.anims[B.idx(x, y)] = now();
    this.lastMove = { x: x, y: y, player: player };
    var p = palette(player);
    this.ripples.push({ x: this.px(x), y: this.px(y), t0: now(), dur: 620, color: p.main });
    this.burst(this.px(x), this.px(y), p.main, this.reduced ? 6 : 16, 1);
  };

  Renderer.prototype.setWinLine = function (cells) {
    this.winLine = cells || null;
    this.winAt = now();
    if (!cells) return;
    var self = this;
    cells.forEach(function (c, i) {
      var px = self.px(c[0]), py = self.px(c[1]);
      var color = palette(self.board[B.idx(c[0], c[1])]).main;
      self.ripples.push({ x: px, y: py, t0: now() + i * 60, dur: 900, color: color });
      self.burst(px, py, color, self.reduced ? 8 : 26, 1.6);
    });
  };

  Renderer.prototype.clearEffects = function () {
    this.anims = {}; this.ripples = []; this.particles = [];
    this.winLine = null; this.lastMove = null; this.hover = null;
    this.pending = null; this.hint = null; this.mate = null; this.mateStep = -1;
    this.forbidden = null;
  };

  Renderer.prototype.setPending = function (cell, player) {
    this.pending = cell ? { x: cell.x, y: cell.y, player: player } : null;
  };

  Renderer.prototype.setHint = function (cell) {
    this.hint = cell ? { x: cell.x, y: cell.y, t0: now() } : null;
  };

  /** 禁じ手の点。盤上に×で示して、打てない場所を事前に分かるようにする。 */
  Renderer.prototype.setForbidden = function (points) {
    this.forbidden = (points && points.length) ? points : null;
  };

  Renderer.prototype.setMate = function (moves, step) {
    this.mate = moves && moves.length ? moves : null;
    this.mateStep = step === undefined ? -1 : step;
  };

  Renderer.prototype.setHover = function (cell, player) {
    this.hover = cell ? { x: cell.x, y: cell.y, player: player } : null;
  };

  Renderer.prototype.burst = function (x, y, color, count, power) {
    var max = this.reduced ? 40 : 320;
    for (var i = 0; i < count && this.particles.length < max; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (0.4 + Math.random() * 1.8) * power * (this.cell * 0.07);
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: 420 + Math.random() * 480,
        size: this.cell * (0.03 + Math.random() * 0.06),
        color: color
      });
    }
  };

  /* --- ループ ------------------------------------------------------- */
  Renderer.prototype.start = function () {
    if (this._raf === null) this._raf = global.requestAnimationFrame(this._boundLoop);
  };
  Renderer.prototype.stop = function () {
    if (this._raf !== null) { global.cancelAnimationFrame(this._raf); this._raf = null; }
  };
  Renderer.prototype._loop = function () {
    this._raf = global.requestAnimationFrame(this._boundLoop);
    this.draw();
  };

  /* --- 描画 --------------------------------------------------------- */
  Renderer.prototype.draw = function () {
    var ctx = this.ctx, s = this.size, t = now();
    if (!s) return;

    ctx.clearRect(0, 0, s, s);

    // 背景
    var bg = ctx.createRadialGradient(s * 0.5, s * 0.42, s * 0.08, s * 0.5, s * 0.5, s * 0.78);
    bg.addColorStop(0, COLORS.bg0);
    bg.addColorStop(1, COLORS.bg1);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);

    this._drawGrid(t);
    this._drawLabels();
    this._drawStars();
    this._drawForbidden();
    this._drawHover(t);
    this._drawStones(t);
    this._drawLastMove(t);
    this._drawMate(t);
    this._drawHint(t);
    this._drawPending(t);
    this._drawWinLine(t);
    this._drawRipples(t);
    this._drawParticles();
  };

  Renderer.prototype._drawGrid = function (t) {
    var ctx = this.ctx, s = this.size;
    var sweep = this.reduced ? -1 : ((t / 26) % (s * 2.2)) - s * 0.6; // 走査線の位置

    ctx.save();
    ctx.lineWidth = Math.max(0.6, this.cell * 0.028);
    for (var i = 0; i < N; i++) {
      var p = this.px(i);
      var hot = sweep >= 0 && Math.abs(p - sweep) < this.cell * 0.9;
      ctx.strokeStyle = hot ? COLORS.gridHot : COLORS.grid;
      ctx.shadowBlur = hot ? 12 : 0;
      ctx.shadowColor = COLORS.p1;

      ctx.beginPath();
      ctx.moveTo(this.px(0), p); ctx.lineTo(this.px(N - 1), p);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(p, this.px(0)); ctx.lineTo(p, this.px(N - 1));
      ctx.stroke();
    }
    ctx.restore();

    // 外枠
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.lineWidth = Math.max(1, this.cell * 0.04);
    ctx.strokeRect(this.px(0), this.px(0), this.cell * (N - 1), this.cell * (N - 1));
    ctx.restore();
  };

  /** 盤の外周にA-O / 1-15の座標ラベルを薄く描く */
  Renderer.prototype._drawLabels = function () {
    var ctx = this.ctx;
    var fs = Math.max(7, Math.min(13, this.cell * 0.34));
    ctx.save();
    ctx.font = '600 ' + fs.toFixed(1) + 'px "SFMono-Regular", Consolas, monospace';
    ctx.fillStyle = 'rgba(111, 139, 163, 0.75)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < N; i++) {
      ctx.fillText(String.fromCharCode(65 + i), this.px(i), this.margin * 0.45);
      ctx.fillText(String(i + 1), this.margin * 0.45, this.px(i));
    }
    ctx.restore();
  };

  Renderer.prototype._drawStars = function () {
    var ctx = this.ctx, pts = [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
    ctx.save();
    ctx.fillStyle = COLORS.star;
    for (var i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(this.px(pts[i][0]), this.px(pts[i][1]), Math.max(1.6, this.cell * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  Renderer.prototype._drawForbidden = function () {
    if (!this.forbidden) return;
    var ctx = this.ctx, r = this.cell * 0.2;
    ctx.save();
    ctx.strokeStyle = '#ff4d6d';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = Math.max(1.2, this.cell * 0.055);
    ctx.lineCap = 'round';
    ctx.shadowBlur = 6; ctx.shadowColor = '#ff4d6d';
    for (var i = 0; i < this.forbidden.length; i++) {
      var cx = this.px(this.forbidden[i][0]), cy = this.px(this.forbidden[i][1]);
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype._drawHover = function (t) {
    if (!this.hover) return;
    if (this.board[B.idx(this.hover.x, this.hover.y)] !== B.EMPTY) return;
    var ctx = this.ctx, p = palette(this.hover.player);
    var cx = this.px(this.hover.x), cy = this.px(this.hover.y);
    var r = this.cell * 0.40;
    var pulse = 0.5 + 0.5 * Math.sin(t / 220);

    ctx.save();
    ctx.globalAlpha = 0.28 + pulse * 0.22;
    ctx.fillStyle = p.main;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2); ctx.fill();

    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = p.main;
    ctx.lineWidth = Math.max(1, this.cell * 0.035);
    ctx.setLineDash([this.cell * 0.16, this.cell * 0.12]);
    ctx.lineDashOffset = -t / 45;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype._drawStones = function (t) {
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var v = this.board[B.idx(x, y)];
        if (v === B.EMPTY) continue;
        var start = this.anims[B.idx(x, y)];
        var k = start ? Math.min(1, (t - start) / 260) : 1;
        this._stone(this.px(x), this.px(y), v, k, t);
      }
    }
  };

  /** 石ひとつ。k は出現アニメの進捗 0→1。 */
  Renderer.prototype._stone = function (cx, cy, player, k, t) {
    var ctx = this.ctx, p = palette(player);
    var e = easeOut(k);
    var r = this.cell * 0.40 * (0.55 + 0.45 * e) * (1 + 0.12 * (1 - e));

    ctx.save();

    // 外周グロー
    var glow = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.1);
    glow.addColorStop(0, p.main);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.30 * e;
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2); ctx.fill();

    // 本体
    ctx.globalAlpha = e;
    var body = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.36, r * 0.12, cx, cy, r);
    body.addColorStop(0, p.light);
    body.addColorStop(0.42, p.main);
    body.addColorStop(1, p.dark);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    // リング
    ctx.strokeStyle = p.light;
    ctx.globalAlpha = 0.6 * e;
    ctx.lineWidth = Math.max(0.8, r * 0.09);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2); ctx.stroke();

    // 内側のコア（微かに明滅）
    ctx.globalAlpha = (0.4 + 0.25 * Math.sin(t / 400 + cx)) * e;
    ctx.fillStyle = p.light;
    ctx.beginPath(); ctx.arc(cx - r * 0.18, cy - r * 0.2, r * 0.2, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  };

  /** 直前の着手に回転するブラケットを重ねる */
  Renderer.prototype._drawLastMove = function (t) {
    if (!this.lastMove) return;
    var ctx = this.ctx, p = palette(this.lastMove.player);
    var cx = this.px(this.lastMove.x), cy = this.px(this.lastMove.y);
    var r = this.cell * 0.62;
    var rot = this.reduced ? 0 : t / 900;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = p.main;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(1, this.cell * 0.04);
    ctx.shadowBlur = 8; ctx.shadowColor = p.main;
    for (var i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r, i * Math.PI / 2 + 0.35, i * Math.PI / 2 + Math.PI / 2 - 0.35);
      ctx.stroke();
    }
    ctx.restore();
  };

  /** タップ確認モードの選択マーカー。指で隠れても位置が分かるよう十字線を引く。 */
  Renderer.prototype._drawPending = function (t) {
    if (!this.pending) return;
    if (this.board[B.idx(this.pending.x, this.pending.y)] !== B.EMPTY) return;
    var ctx = this.ctx, p = palette(this.pending.player);
    var cx = this.px(this.pending.x), cy = this.px(this.pending.y);
    var pulse = 0.5 + 0.5 * Math.sin(t / 200);

    ctx.save();
    // 盤の端まで伸びる十字線
    ctx.strokeStyle = p.main;
    ctx.globalAlpha = 0.35 + pulse * 0.2;
    ctx.lineWidth = Math.max(1, this.cell * 0.05);
    ctx.setLineDash([this.cell * 0.2, this.cell * 0.14]);
    ctx.lineDashOffset = -t / 40;
    ctx.beginPath();
    ctx.moveTo(this.px(0) - this.margin * 0.5, cy);
    ctx.lineTo(this.px(N - 1) + this.margin * 0.5, cy);
    ctx.moveTo(cx, this.px(0) - this.margin * 0.5);
    ctx.lineTo(cx, this.px(N - 1) + this.margin * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // 半透明の石
    var r = this.cell * 0.42;
    ctx.globalAlpha = 0.55;
    var body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.34, r * 0.1, cx, cy, r);
    body.addColorStop(0, p.light);
    body.addColorStop(0.45, p.main);
    body.addColorStop(1, p.dark);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    // 外周のターゲットリング
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.4, this.cell * 0.055);
    ctx.shadowBlur = 12; ctx.shadowColor = p.main;
    ctx.beginPath(); ctx.arc(cx, cy, r * (1.25 + pulse * 0.12), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  };

  /** ヒントの推奨手。琥珀色の照準で示す。 */
  Renderer.prototype._drawHint = function (t) {
    if (!this.hint) return;
    var ctx = this.ctx;
    var cx = this.px(this.hint.x), cy = this.px(this.hint.y);
    var age = (t - this.hint.t0) / 1000;
    var pulse = 0.5 + 0.5 * Math.sin(t / 180);
    var r = this.cell * (0.5 + pulse * 0.12);

    ctx.save();
    ctx.strokeStyle = '#ffc75f';
    ctx.shadowColor = '#ffc75f';
    ctx.shadowBlur = 16;
    ctx.globalAlpha = Math.max(0.45, 1 - age * 0.02);
    ctx.lineWidth = Math.max(1.5, this.cell * 0.06);

    // 四隅を欠いた照準リング
    for (var i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, i * Math.PI / 2 + 0.28, i * Math.PI / 2 + Math.PI / 2 - 0.28);
      ctx.stroke();
    }
    ctx.globalAlpha *= 0.85;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.35, cy); ctx.lineTo(cx + r * 0.35, cy);
    ctx.moveTo(cx, cy - r * 0.35); ctx.lineTo(cx, cy + r * 0.35);
    ctx.stroke();
    ctx.restore();
  };

  /** 詰み筋。手順を番号付きの半透明の石で重ねる。 */
  Renderer.prototype._drawMate = function (t) {
    if (!this.mate) return;
    var ctx = this.ctx;
    var r = this.cell * 0.36;

    for (var i = 0; i < this.mate.length; i++) {
      var m = this.mate[i];
      if (this.board[B.idx(m.x, m.y)] !== B.EMPTY) continue;
      var focused = (this.mateStep === i);
      var dimmed = (this.mateStep >= 0 && i > this.mateStep);
      var p = palette(m.player);
      var cx = this.px(m.x), cy = this.px(m.y);

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.18 : (focused ? 0.92 : 0.5);

      ctx.fillStyle = m.forced ? 'rgba(6,10,22,0.85)' : p.main;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = p.main;
      ctx.lineWidth = Math.max(1.2, this.cell * (focused ? 0.07 : 0.04));
      if (focused) { ctx.shadowBlur = 14; ctx.shadowColor = p.main; }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

      // 手順番号
      ctx.shadowBlur = 0;
      ctx.globalAlpha = dimmed ? 0.3 : 1;
      ctx.fillStyle = m.forced ? p.main : '#04121a';
      ctx.font = '700 ' + Math.max(8, this.cell * 0.42).toFixed(1) + 'px "SFMono-Regular", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), cx, cy + this.cell * 0.015);
      ctx.restore();
    }
    void t;
  };

  Renderer.prototype._drawWinLine = function (t) {
    if (!this.winLine || this.winLine.length < 2) return;
    var ctx = this.ctx;
    var a = this.winLine[0], b = this.winLine[this.winLine.length - 1];
    var x1 = this.px(a[0]), y1 = this.px(a[1]);
    var x2 = this.px(b[0]), y2 = this.px(b[1]);
    var k = Math.min(1, (t - this.winAt) / 420);
    var e = easeOut(k);
    var ex = x1 + (x2 - x1) * e, ey = y1 + (y2 - y1) * e;
    var pulse = 0.65 + 0.35 * Math.sin(t / 160);
    var color = palette(this.board[B.idx(a[0], a[1])]).main;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.shadowColor = color;

    ctx.globalAlpha = 0.22 * pulse;
    ctx.shadowBlur = 26;
    ctx.lineWidth = this.cell * 0.72;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();

    ctx.globalAlpha = 0.95;
    ctx.shadowBlur = 16;
    ctx.lineWidth = Math.max(2, this.cell * 0.11);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, this.cell * 0.035);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype._drawRipples = function (t) {
    var ctx = this.ctx;
    for (var i = this.ripples.length - 1; i >= 0; i--) {
      var r = this.ripples[i];
      var k = (t - r.t0) / r.dur;
      if (k < 0) continue;
      if (k >= 1) { this.ripples.splice(i, 1); continue; }
      var e = easeOut(k);
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.shadowBlur = 12; ctx.shadowColor = r.color;
      ctx.lineWidth = Math.max(1, this.cell * 0.08 * (1 - k));
      ctx.beginPath();
      ctx.arc(r.x, r.y, this.cell * (0.3 + e * 1.9), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  };

  Renderer.prototype._drawParticles = function () {
    var ctx = this.ctx;
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i];
      p.life += 16.7;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.965; p.vy *= 0.965;
      p.vy += this.cell * 0.0016; // わずかな重力

      var alpha = 1 - p.life / p.max;
      ctx.save();
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 8; ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.size * alpha), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  global.CG = global.CG || {};
  global.CG.Renderer = Renderer;
  global.CG.COLORS = COLORS;
})(window);
