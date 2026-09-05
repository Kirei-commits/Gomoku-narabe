/**
 * audio.js — Web Audio API による効果音の合成（外部音源ファイル不要）
 * AudioContext はユーザー操作を伴う最初の再生時に生成する（自動再生ポリシー対策）。
 */
(function (global) {
  'use strict';

  function Sfx() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._noiseBuf = null;
  }

  Sfx.prototype._ensure = function () {
    if (!this.enabled) return false;
    if (!this.ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { this.enabled = false; return false; }
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.enabled = false; return false; }
    }
    if (this.ctx.state === 'suspended') { this.ctx.resume().catch(function () {}); }
    return true;
  };

  Sfx.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (this.master) this.master.gain.value = on ? 0.32 : 0;
    if (on) this._ensure();
  };

  /** 基本のトーン生成 */
  Sfx.prototype._tone = function (opt) {
    if (!this._ensure()) return;
    var ctx = this.ctx, t0 = ctx.currentTime + (opt.delay || 0);
    var dur = opt.dur || 0.16;

    var osc = ctx.createOscillator();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.freq, t0);
    if (opt.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t0 + dur);

    var gain = ctx.createGain();
    var peak = opt.gain === undefined ? 0.5 : opt.gain;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    var node = osc;
    if (opt.filter) {
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(opt.filter, t0);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, opt.filter * 0.25), t0 + dur);
      node.connect(lp); node = lp;
    }
    node.connect(gain);
    gain.connect(this.master);

    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  /** ノイズ（打鍵時のアタック感、勝利時のスパーク） */
  Sfx.prototype._noise = function (dur, gainVal, freq, delay) {
    if (!this._ensure()) return;
    var ctx = this.ctx, t0 = ctx.currentTime + (delay || 0);
    if (!this._noiseBuf) {
      var len = Math.floor(ctx.sampleRate * 0.4);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var ch = buf.getChannelData(0);
      for (var i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
      this._noiseBuf = buf;
    }
    var src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq || 1800, t0);
    bp.Q.value = 1.2;

    var g = ctx.createGain();
    g.gain.setValueAtTime(gainVal || 0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  };

  /** 着手音。プレイヤーごとに音程を変える。 */
  Sfx.prototype.place = function (player) {
    var base = player === 1 ? 660 : 460;
    this._tone({ type: 'triangle', freq: base, to: base * 0.5, dur: 0.14, gain: 0.34, filter: 2600 });
    this._tone({ type: 'square', freq: base * 2, to: base, dur: 0.05, gain: 0.08 });
    this._noise(0.07, 0.12, player === 1 ? 2600 : 1700);
  };

  /** UI操作のクリック音 */
  Sfx.prototype.ui = function () {
    this._tone({ type: 'square', freq: 880, to: 1200, dur: 0.05, gain: 0.1 });
  };

  /** 着手できない場所を押したときのブザー */
  Sfx.prototype.error = function () {
    this._tone({ type: 'sawtooth', freq: 150, to: 90, dur: 0.18, gain: 0.16, filter: 900 });
  };

  /** 待った */
  Sfx.prototype.undo = function () {
    this._tone({ type: 'triangle', freq: 520, to: 260, dur: 0.16, gain: 0.2 });
  };

  /** 勝利ファンファーレ（上昇アルペジオ＋スパーク） */
  Sfx.prototype.win = function () {
    var seq = [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < seq.length; i++) {
      this._tone({ type: 'square', freq: seq[i], dur: 0.22, gain: 0.16, delay: i * 0.09, filter: 4200 });
      this._tone({ type: 'sine', freq: seq[i] * 2, dur: 0.18, gain: 0.07, delay: i * 0.09 });
    }
    this._noise(0.5, 0.1, 3200, 0.28);
  };

  /** 敗北（下降） */
  Sfx.prototype.lose = function () {
    var seq = [440, 349.23, 261.63, 174.61];
    for (var i = 0; i < seq.length; i++) {
      this._tone({ type: 'sawtooth', freq: seq[i], dur: 0.3, gain: 0.12, delay: i * 0.11, filter: 1200 });
    }
  };

  /** 引き分け */
  Sfx.prototype.draw = function () {
    this._tone({ type: 'triangle', freq: 392, dur: 0.4, gain: 0.14 });
    this._tone({ type: 'triangle', freq: 392 * 1.5, dur: 0.4, gain: 0.09, delay: 0.12 });
  };

  global.CG = global.CG || {};
  global.CG.Sfx = new Sfx();
})(window);
