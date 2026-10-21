/*!
 * finger-cursor.js
 * Turns the mouse cursor into a telescopic finger pointer (the kind teachers
 * use) with a soft shadow that fakes depth. Clicking "taps" the screen: the
 * pointer dips down and the shadow tucks in under the fingertip.
 * MIT License
 */
(function (global) {
  'use strict';

  // Each hand is drawn with the rod running down the +y axis and the
  // fingertip near (0, 0). `hotspot` is the exact point that does the clicking.
  var HANDS = {
    point: {
      hotspot: [0, 0],
      svg:
        '<path class="fc-skin" d="M-10 56 L10 56 L5.5 80 L-5.5 80 Z"/>' +
        '<rect class="fc-skin" x="-25" y="35" width="12" height="23" rx="6" transform="rotate(-22 -19 46)"/>' +
        '<rect class="fc-skin" x="-17" y="27" width="34" height="35" rx="13"/>' +
        '<rect class="fc-skin" x="-6.5" y="0" width="13" height="40" rx="6.5"/>' +
        '<path class="fc-line" d="M5 36 q8 0 10 5 M5 44 q8 0 10 5 M5 52 q7 0 9 4"/>' +
        '<path class="fc-shine" d="M-2.5 6 L-2.5 24"/>' +
        '<path class="fc-shine" d="M-11 33 L-11 50"/>'
    },
    peace: {
      hotspot: [-14, 3],
      svg:
        '<path class="fc-skin" d="M-10 56 L10 56 L5.5 80 L-5.5 80 Z"/>' +
        '<rect class="fc-skin" x="-12.5" y="2" width="13" height="40" rx="6.5" transform="rotate(-12 -6 42)"/>' +
        '<rect class="fc-skin" x="0" y="0" width="13" height="42" rx="6.5" transform="rotate(12 6.5 42)"/>' +
        '<rect class="fc-skin" x="-26" y="36" width="12" height="22" rx="6" transform="rotate(-25 -20 47)"/>' +
        '<rect class="fc-skin" x="-17" y="30" width="34" height="32" rx="13"/>' +
        '<path class="fc-line" d="M-2 40 q6 -3 12 0 M-2 48 q6 -3 12 0"/>' +
        '<path class="fc-shine" d="M-12 10 L-9 26"/>' +
        '<path class="fc-shine" d="M9 9 L6.5 24"/>'
    }
  };

  var DEFAULTS = {
    hand: 'point',       // 'point' | 'peace'
    color: '#8fd3ea',    // rubber + handle colour
    size: 1,             // overall scale
    angle: -32,          // rod angle in degrees (negative = handle to the bottom-right)
    hoverDepth: 1,       // 0..1.5 how high the tip floats when not pressed
    tilt: true,          // lean a little with mouse movement
    ripple: true,        // ring on the screen when you tap
    sound: true,         // little rubbery "tok" when you tap
    volume: 0.5,         // 0..1
    zIndex: 2147483647
  };

  var instances = 0;
  var audioCtx = null;

  // Synthesized tap: a short pitched "tok" from the rubber fingertip plus a
  // tiny noise click from the glass. No audio files needed.
  function playTap(volume) {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC || volume <= 0) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    var t = audioCtx.currentTime;
    var out = audioCtx.createGain();
    out.gain.value = volume;
    out.connect(audioCtx.destination);

    var osc = audioCtx.createOscillator();
    var og = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520 + Math.random() * 60, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.7, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.12);

    var len = Math.floor(audioCtx.sampleRate * 0.02);
    var buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var noise = audioCtx.createBufferSource();
    var hp = audioCtx.createBiquadFilter();
    var ng = audioCtx.createGain();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    ng.gain.value = 0.25;
    noise.buffer = buf;
    noise.connect(hp).connect(ng).connect(out);
    noise.start(t);
  }

  function defined(o) {
    var r = {};
    for (var k in o) if (o[k] !== undefined) r[k] = o[k];
    return r;
  }

  function shade(hex, amt) {
    var n = parseInt(hex.replace('#', ''), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var f = function (c) {
      return Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    };
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function buildSVG(id, hand, color) {
    var h = HANDS[hand] || HANDS.point;
    var dx = -h.hotspot[0], dy = -h.hotspot[1];
    var steel = id + '-steel', frost = id + '-frost', skin = id + '-skin';
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="1110" viewBox="-40 -10 80 1110" ' +
      'style="position:absolute;left:-40px;top:-10px;overflow:visible">' +
      '<defs>' +
      '<linearGradient id="' + steel + '" x1="0" x2="1">' +
      '<stop offset="0" stop-color="#5d646c"/><stop offset=".35" stop-color="#f4f6f8"/>' +
      '<stop offset=".6" stop-color="#a9b0b8"/><stop offset="1" stop-color="#4f555c"/></linearGradient>' +
      '<linearGradient id="' + frost + '" x1="0" x2="1">' +
      '<stop offset="0" stop-color="' + shade(color, -0.25) + '"/><stop offset=".32" stop-color="' + shade(color, 0.45) + '"/>' +
      '<stop offset=".6" stop-color="' + color + '"/><stop offset="1" stop-color="' + shade(color, -0.32) + '"/></linearGradient>' +
      '<linearGradient id="' + skin + '" x1="0" x2="1">' +
      '<stop offset="0" stop-color="' + shade(color, 0.3) + '"/><stop offset="1" stop-color="' + shade(color, -0.12) + '"/></linearGradient>' +
      '</defs>' +
      '<style>' +
      '.fc-skin{fill:url(#' + skin + ');stroke:' + shade(color, -0.3) + ';stroke-width:1.2}' +
      '.fc-line{fill:none;stroke:' + shade(color, -0.3) + ';stroke-width:1.4;stroke-linecap:round}' +
      '.fc-shine{fill:none;stroke:#fff;stroke-opacity:.55;stroke-width:2.6;stroke-linecap:round}' +
      '</style>' +
      '<g transform="translate(' + dx + ' ' + dy + ')">' +
      // telescopic rod, thinnest section first
      '<g fill="url(#' + steel + ')">' +
      '<rect x="-2" y="80" width="4" height="202"/>' +
      '<rect x="-3.6" y="278" width="7.2" height="9" rx="2"/>' +
      '<rect x="-3" y="285" width="6" height="190"/>' +
      '<rect x="-4.6" y="471" width="9.2" height="9" rx="2"/>' +
      '<rect x="-4" y="478" width="8" height="146"/>' +
      '<rect x="-7.5" y="620" width="15" height="18" rx="3"/>' +
      '<rect x="-5" y="76" width="10" height="8" rx="2"/>' +
      '</g>' +
      '<path d="M-7.5 626 H7.5 M-7.5 631 H7.5" stroke="#3d4248" stroke-opacity=".5" stroke-width="1"/>' +
      // frosted handle
      '<rect x="-12" y="636" width="24" height="460" rx="11" fill="url(#' + frost + ')"/>' +
      '<rect x="-5" y="650" width="3" height="430" rx="1.5" fill="#fff" opacity=".35"/>' +
      h.svg +
      '</g></svg>'
    );
  }

  function FingerCursor(options) {
    this.opts = Object.assign({}, DEFAULTS, defined(options || {}));
    this.id = 'fc' + (++instances);
    this.x = -9999; this.y = -9999;
    this.depth = this.opts.hoverDepth; // 0 = touching the screen
    this.vel = 0;
    this.target = this.opts.hoverDepth;
    this.tiltNow = 0; this.vx = 0;
    this.visible = false;
    this.enabled = false;
    this._onMove = this._onMove.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._tick = this._tick.bind(this);
  }

  FingerCursor.prototype.enable = function () {
    if (this.enabled) return this;
    // Phones/tablets have no hovering cursor to replace.
    if (global.matchMedia && !global.matchMedia('(pointer: fine)').matches) return this;
    this.enabled = true;
    this._mount();
    document.documentElement.classList.add('fc-on');
    global.addEventListener('pointermove', this._onMove, { passive: true });
    global.addEventListener('pointerdown', this._onDown, { passive: true });
    global.addEventListener('pointerup', this._onUp, { passive: true });
    global.addEventListener('blur', this._onUp);
    document.addEventListener('mouseout', this._onLeave);
    this._raf = requestAnimationFrame(this._tick);
    return this;
  };

  FingerCursor.prototype.disable = function () {
    if (!this.enabled) return this;
    this.enabled = false;
    cancelAnimationFrame(this._raf);
    global.removeEventListener('pointermove', this._onMove);
    global.removeEventListener('pointerdown', this._onDown);
    global.removeEventListener('pointerup', this._onUp);
    global.removeEventListener('blur', this._onUp);
    document.removeEventListener('mouseout', this._onLeave);
    document.documentElement.classList.remove('fc-on');
    if (this.root) this.root.remove();
    this.root = null;
    return this;
  };

  FingerCursor.prototype.set = function (options) {
    var rebuild = options && ('hand' in options || 'color' in options);
    Object.assign(this.opts, defined(options || {}));
    if (this.target > 0) this.target = this.opts.hoverDepth;
    if (rebuild && this.root) {
      this.root.remove();
      this._mount();
    }
    return this;
  };

  FingerCursor.prototype._mount = function () {
    if (!document.getElementById('fc-style')) {
      var st = document.createElement('style');
      st.id = 'fc-style';
      st.textContent =
        'html.fc-on,html.fc-on *{cursor:none!important}' +
        '.fc-root{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;will-change:transform}' +
        '.fc-root>div{position:absolute;left:0;top:0;transform-origin:0 0}' +
        '.fc-shadow svg{filter:brightness(0)}' +
        '.fc-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;' +
        'pointer-events:none;border:2px solid rgba(0,0,0,.25);animation:fc-ripple .45s ease-out forwards}' +
        '@keyframes fc-ripple{from{transform:scale(.15);opacity:1}to{transform:scale(1);opacity:0}}';
      document.head.appendChild(st);
    }
    var root = document.createElement('div');
    root.className = 'fc-root';
    root.style.zIndex = this.opts.zIndex;
    root.style.opacity = this.visible ? '1' : '0';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="fc-shadow">' + buildSVG(this.id + 's', this.opts.hand, this.opts.color) + '</div>' +
      '<div class="fc-pointer">' + buildSVG(this.id + 'p', this.opts.hand, this.opts.color) + '</div>';
    document.body.appendChild(root);
    this.root = root;
    this.shadowEl = root.children[0];
    this.pointerEl = root.children[1];
    this._render();
  };

  FingerCursor.prototype._onMove = function (e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') {
      this._show(false);
      return;
    }
    if (this.x > -9000) this.vx += (e.clientX - this.x);
    this.x = e.clientX;
    this.y = e.clientY;
    this._show(true);
  };

  FingerCursor.prototype._onDown = function (e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (e.button !== undefined && e.button !== 0) return;
    this.x = e.clientX; this.y = e.clientY;
    this.target = 0;
    this.vel -= 0.06; // little jab so the tap feels snappy
    if (this.opts.sound) playTap(this.opts.volume);
    if (this.opts.ripple) {
      var r = document.createElement('div');
      r.className = 'fc-ripple';
      r.style.left = this.x + 'px';
      r.style.top = this.y + 'px';
      r.style.zIndex = this.opts.zIndex - 1;
      document.body.appendChild(r);
      setTimeout(function () { r.remove(); }, 500);
    }
  };

  FingerCursor.prototype._onUp = function () {
    this.target = this.opts.hoverDepth;
  };

  FingerCursor.prototype._onLeave = function (e) {
    if (!e.relatedTarget) this._show(false);
  };

  FingerCursor.prototype._show = function (on) {
    if (on === this.visible) return;
    this.visible = on;
    if (this.root) this.root.style.opacity = on ? '1' : '0';
  };

  FingerCursor.prototype._tick = function () {
    // Spring towards the target depth. Pressing is stiffer than lifting.
    var k = this.target < this.depth ? 0.32 : 0.12;
    this.vel += (this.target - this.depth) * k;
    this.vel *= 0.62;
    this.depth += this.vel;
    if (this.depth < 0) { this.depth = 0; this.vel = 0; }

    this.vx *= 0.8;
    var wantTilt = this.opts.tilt ? clamp(-this.vx * 0.35, -9, 9) : 0;
    this.tiltNow += (wantTilt - this.tiltNow) * 0.12;
    this.vx *= 0.5;

    this._render();
    this._raf = requestAnimationFrame(this._tick);
  };

  FingerCursor.prototype._render = function () {
    if (!this.root) return;
    var z = this.depth; // 0 touching .. ~1 hovering
    var s = this.opts.size;
    var angle = this.opts.angle + this.tiltNow;

    // The fingertip shadow slides out from under the tip as it rises. The
    // shadow is also scaled up around the tip, so the far end of the rod
    // (which is further from the screen) casts a shadow further away, even
    // while the tip is touching.
    var sx = lerp(2, 20, z) * s;
    var sy = lerp(3, 26, z) * s;
    var blur = lerp(1.2, 6, z);
    var shadowOpacity = lerp(0.42, 0.2, clamp(z, 0, 1.5));
    var shadowScale = s * lerp(1.035, 1.09, z);
    var lift = s * lerp(0.96, 1, z); // nearer the screen = slightly smaller

    this.root.style.transform = 'translate3d(' + this.x + 'px,' + this.y + 'px,0)';
    this.pointerEl.style.transform = 'rotate(' + angle + 'deg) scale(' + lift + ')';
    this.shadowEl.style.transform =
      'translate(' + sx + 'px,' + sy + 'px) rotate(' + angle + 'deg) scale(' + shadowScale + ')';
    this.shadowEl.style.opacity = shadowOpacity;
    this.shadowEl.firstChild.style.filter = 'brightness(0) blur(' + blur.toFixed(2) + 'px)';
  };

  FingerCursor.hands = Object.keys(HANDS);

  FingerCursor.init = function (options) {
    return new FingerCursor(options).enable();
  };

  global.FingerCursor = FingerCursor;
  if (typeof module === 'object' && module.exports) module.exports = FingerCursor;

  // <script src="finger-cursor.js" data-auto data-hand="peace"></script>
  var cur = document.currentScript;
  if (cur && cur.hasAttribute('data-auto')) {
    var start = function () {
      FingerCursor.init({
        hand: cur.getAttribute('data-hand') || undefined,
        color: cur.getAttribute('data-color') || undefined,
        size: cur.getAttribute('data-size') ? parseFloat(cur.getAttribute('data-size')) : undefined,
        sound: cur.getAttribute('data-sound') === 'off' ? false : undefined
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : this);
