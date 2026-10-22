/*!
 * finger-cursor.js
 * Turns the mouse cursor into a 3D telescopic finger pointer (the kind
 * teachers use), rendered with three.js. The pointer floats above the page
 * and casts a real shadow onto it. Clicking "taps" the screen: the fingertip
 * drops onto the glass and the shadow meets it, with a little "tok".
 * MIT License
 */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';

const DEFAULTS = {
  hand: 'point',       // 'point' | 'peace'
  color: '#8fd3ea',    // rubber hand + handle colour
  size: 1,             // overall scale
  angle: -32,          // rod angle on screen in degrees (negative = handle to the bottom-right)
  elevation: 26,       // how steeply the rod rises off the screen, in degrees
  hoverDepth: 1,       // 0..1.5 how high the tip floats when not pressed
  tilt: true,          // lean a little with mouse movement
  ripple: true,        // ring on the screen when you tap
  sound: true,         // little rubbery "tok" when you tap
  volume: 0.5,         // 0..1
  zIndex: 2147483647,
  three: null          // pass your own THREE module to skip the CDN fetch
};

const HOVER_HEIGHT = 55; // px the fingertip floats above the page at hoverDepth 1
const TIP_RADIUS = 7.5;

let threePromise = null;
let audioCtx = null;

function loadThree(custom) {
  if (custom) return Promise.resolve(custom);
  if (!threePromise) threePromise = import(/* webpackIgnore: true */ THREE_URL);
  return threePromise;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function defined(o) {
  const r = {};
  for (const k in o) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

// Synthesized tap: a hard plastic tip clicking on glass. A very short
// band-passed noise transient gives the "tick", and a few inharmonic high
// partials that die out in ~40ms give the hollow plastic ring. No audio files.
function playTap(volume) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || volume <= 0) return;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;
  const out = audioCtx.createGain();
  out.gain.value = volume;
  out.connect(audioCtx.destination);

  const len = Math.floor(audioCtx.sampleRate * 0.012);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const noise = audioCtx.createBufferSource();
  const bp = audioCtx.createBiquadFilter();
  const ng = audioCtx.createGain();
  bp.type = 'bandpass';
  bp.frequency.value = 3200 + Math.random() * 600;
  bp.Q.value = 1.4;
  ng.gain.value = 1.1;
  noise.buffer = buf;
  noise.connect(bp).connect(ng).connect(out);
  noise.start(t);

  const base = 1750 + Math.random() * 150;
  [[1, 0.35, 0.045], [1.73, 0.22, 0.03], [2.61, 0.14, 0.02], [3.9, 0.08, 0.012]].forEach(([ratio, amp, decay]) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = base * ratio;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.01);
  });
}

// A soft studio-ish environment so the steel has something to reflect.
function makeEnvironment(THREE) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#c9d0d6');
  grad.addColorStop(0.42, '#8d969e');
  grad.addColorStop(0.5, '#4c535a');
  grad.addColorStop(1, '#1f2428');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.fillRect(40, 20, 30, 50);
  g.fillRect(170, 26, 20, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBlobTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/*
 * Model space: the rod runs along +Y away from the fingertip, +Z is the front
 * of the hand (facing the viewer) and +X is the screen-left side. The fist
 * sits on -X, so the raised finger is on the thumb side and reads as ☝️.
 * Units are CSS pixels.
 */
function buildModel(THREE, hand, color) {
  const rubber = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.6
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe4e8, metalness: 1, roughness: 0.2 });
  const frosted = new THREE.MeshStandardMaterial({ color, roughness: 0.8, envMapIntensity: 0.6 });
  const root = new THREE.Group();

  const add = (geo, mat, x, y, z, rz = 0, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 8, 20);
  const cyl = (rt, rb, h) => new THREE.CylinderGeometry(rt, rb, h, 24);

  // A straight finger hinged at its base; returns a marker at the fingertip.
  const finger = (bx, by, rz, len) => {
    const pivot = new THREE.Group();
    pivot.position.set(bx, by, 0);
    pivot.rotation.z = rz;
    root.add(pivot);
    add(capsule(TIP_RADIUS, len), rubber, 0, -(len / 2 + TIP_RADIUS), 0, 0, pivot);
    const tip = new THREE.Object3D();
    tip.position.set(0, -(len + TIP_RADIUS * 2), 0);
    pivot.add(tip);
    return tip;
  };

  // Chunky cartoon glove like the classroom pointers: short fat fingers.
  let tip;
  if (hand === 'peace') {
    tip = finger(4, 40, 0.26, 19);        // index
    finger(-10, 40, -0.22, 21);            // middle
    add(new THREE.SphereGeometry(1, 32, 24), rubber, -4, 48, -1).scale.set(21, 18, 14);
    add(capsule(6, 12), rubber, -10, 44, 9, Math.PI / 2);   // curled ring finger
    add(capsule(5.6, 10), rubber, -11, 55, 8, Math.PI / 2); // curled pinky
  } else {
    tip = finger(0, 38, 0, 18);
    add(new THREE.SphereGeometry(1, 32, 24), rubber, -11, 46, -1).scale.set(21, 19, 14);
    // three curled fingers, knuckles facing the viewer
    add(capsule(6, 14), rubber, -15, 34, 8.5, Math.PI / 2);
    add(capsule(6, 14), rubber, -15, 45.5, 9, Math.PI / 2);
    add(capsule(5.6, 12), rubber, -14, 56.5, 8, Math.PI / 2);
  }
  // thumb wraps across the front of the fist
  add(capsule(6.4, 15), rubber, -1, 57, 11, Math.PI / 2 - 0.35);
  // wrist tapering into the rod
  add(cyl(6, 12, 18), rubber, -3, 72, 0, -0.12);

  // telescopic rod: a long thin top section, stepped collars, a thicker tube
  add(cyl(6, 6, 8), steel, 0, 83, 0);
  add(cyl(2.2, 2.2, 276), steel, 0, 225, 0);
  add(cyl(3.4, 3.4, 6), steel, 0, 365, 0);
  add(cyl(4.2, 4.2, 6), steel, 0, 371, 0);
  add(cyl(5, 5, 6), steel, 0, 377, 0);
  add(cyl(5.6, 5.6, 8), steel, 0, 384, 0);
  add(cyl(4.8, 4.8, 136), steel, 0, 456, 0);
  add(cyl(13.6, 13.6, 10), steel, 0, 527, 0);
  // fat frosted handle
  add(capsule(13, 540), frosted, 0, 532 + 13 + 270, 0);

  // shift everything so the fingertip sits exactly on the origin
  root.updateMatrixWorld(true);
  const hot = tip.getWorldPosition(new THREE.Vector3());
  const model = new THREE.Group();
  root.position.sub(hot);
  model.add(root);
  model.userData.materials = { rubber, frosted };
  return model;
}

export default class FingerCursor {
  constructor(options) {
    this.opts = Object.assign({}, DEFAULTS, defined(options || {}));
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
    this._onResize = this._onResize.bind(this);
    this._tick = this._tick.bind(this);
  }

  static async init(options) {
    return new FingerCursor(options).enable();
  }

  async enable() {
    if (this.enabled) return this;
    // Phones/tablets have no hovering cursor to replace.
    if (window.matchMedia && !window.matchMedia('(pointer: fine)').matches) return this;
    this.enabled = true;
    let THREE;
    try {
      THREE = await loadThree(this.opts.three);
      this.THREE = THREE;
      this._mount();
    } catch (err) {
      // Leave the normal cursor alone if three.js or WebGL is unavailable.
      console.warn('[finger-cursor] could not start:', err);
      this.enabled = false;
      return this;
    }
    if (!this.enabled) { this._unmount(); return this; } // disabled while loading
    document.documentElement.classList.add('fc-on');
    window.addEventListener('pointermove', this._onMove, { passive: true });
    window.addEventListener('pointerdown', this._onDown, { passive: true });
    window.addEventListener('pointerup', this._onUp, { passive: true });
    window.addEventListener('blur', this._onUp);
    window.addEventListener('resize', this._onResize);
    document.addEventListener('mouseout', this._onLeave);
    this._raf = requestAnimationFrame(this._tick);
    return this;
  }

  disable() {
    if (!this.enabled) return this;
    this.enabled = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('blur', this._onUp);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('mouseout', this._onLeave);
    document.documentElement.classList.remove('fc-on');
    this._unmount();
    return this;
  }

  set(options) {
    const o = defined(options || {});
    Object.assign(this.opts, o);
    if (this.target > 0) this.target = this.opts.hoverDepth;
    if (!this.scene) return this;
    if ('hand' in o) this._setModel();
    else if ('color' in o) {
      const { rubber, frosted } = this.model.userData.materials;
      rubber.color.set(this.opts.color);
      frosted.color.set(this.opts.color);
    }
    return this;
  }

  _mount() {
    const THREE = this.THREE;
    if (!document.getElementById('fc-style')) {
      const st = document.createElement('style');
      st.id = 'fc-style';
      st.textContent =
        'html.fc-on,html.fc-on *{cursor:none!important}' +
        '.fc-canvas{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none}' +
        '.fc-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;' +
        'pointer-events:none;border:2px solid rgba(0,0,0,.25);animation:fc-ripple .45s ease-out forwards}' +
        '@keyframes fc-ripple{from{transform:scale(.15);opacity:1}to{transform:scale(1);opacity:0}}';
      document.head.appendChild(st);
    }

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.className = 'fc-canvas';
    canvas.style.zIndex = this.opts.zIndex;
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.environment = makeEnvironment(THREE);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 0.55));

    // Key light from above the top of the screen, so the shadow drops
    // straight down and separates from the rod, which leans down-right.
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    const sc = sun.shadow.camera;
    sc.left = -1300; sc.right = 1300; sc.top = 1300; sc.bottom = -1300;
    sc.near = 1; sc.far = 4000;
    scene.add(sun, sun.target);

    // The page itself: an invisible plane that only shows the shadow.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.32 })
    );
    ground.receiveShadow = true;
    scene.add(ground);

    // Soft contact shadow right under the fingertip, strongest on touch.
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: makeBlobTexture(THREE), transparent: true, depthWrite: false })
    );
    blob.position.z = 0.2;
    scene.add(blob);

    const camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
    const pivot = new THREE.Group();
    pivot.visible = this.visible;
    blob.visible = this.visible;
    scene.add(pivot);

    Object.assign(this, { renderer, scene, camera, sun, ground, blob, pivot, canvas });
    this._setModel();
    this._onResize();
  }

  _unmount() {
    if (!this.renderer) return;
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    if (this.scene.environment) this.scene.environment.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.renderer = this.scene = this.model = null;
  }

  _setModel() {
    if (this.model) {
      this.pivot.remove(this.model);
      this.model.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      Object.values(this.model.userData.materials).forEach((m) => m.dispose());
    }
    this.model = buildModel(this.THREE, this.opts.hand, this.opts.color);
    this.pivot.add(this.model);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.w = w; this.h = h;
    // Place the camera so the z = 0 plane maps 1:1 onto CSS pixels.
    this.dist = (h / 2) / Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.aspect = w / h;
    this.camera.position.set(0, 0, this.dist);
    this.camera.near = 1;
    this.camera.far = this.dist + 4000;
    this.camera.updateProjectionMatrix();
    this.ground.scale.set(w * 3, h * 3, 1);
    this.renderer.setSize(w, h, false);
  }

  _onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') {
      this._show(false);
      return;
    }
    if (this.x > -9000) this.vx += (e.clientX - this.x);
    this.x = e.clientX;
    this.y = e.clientY;
    this._show(true);
  }

  _onDown(e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (e.button !== undefined && e.button !== 0) return;
    this.x = e.clientX; this.y = e.clientY;
    this.target = 0;
    this.vel -= 0.06; // little jab so the tap feels snappy
    if (this.opts.sound) playTap(this.opts.volume);
    if (this.opts.ripple) {
      const r = document.createElement('div');
      r.className = 'fc-ripple';
      r.style.left = this.x + 'px';
      r.style.top = this.y + 'px';
      r.style.zIndex = this.opts.zIndex - 1;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 500);
    }
  }

  _onUp() {
    this.target = this.opts.hoverDepth;
  }

  _onLeave(e) {
    if (!e.relatedTarget) this._show(false);
  }

  _show(on) {
    if (on === this.visible) return;
    this.visible = on;
    if (this.pivot) this.pivot.visible = this.blob.visible = on;
  }

  _tick() {
    // Spring towards the target depth. Pressing is stiffer than lifting.
    const k = this.target < this.depth ? 0.32 : 0.12;
    this.vel += (this.target - this.depth) * k;
    this.vel *= 0.62;
    this.depth += this.vel;
    if (this.depth < 0) { this.depth = 0; this.vel = 0; }

    this.vx *= 0.8;
    const wantTilt = this.opts.tilt ? clamp(-this.vx * 0.35, -9, 9) : 0;
    this.tiltNow += (wantTilt - this.tiltNow) * 0.12;
    this.vx *= 0.5;

    this._render();
    this._raf = requestAnimationFrame(this._tick);
  }

  _render() {
    if (!this.renderer) return;
    const THREE = this.THREE;
    const s = this.opts.size;
    const z = this.depth;

    // Fingertip height above the page. At depth 0 the rubber tip rests on it.
    const tipZ = (TIP_RADIUS + z * HOVER_HEIGHT) * s;
    // The point on the page under the mouse, in world units.
    const px = this.x - this.w / 2;
    const py = this.h / 2 - this.y;
    // Slide the tip along the camera ray so it still lines up with the mouse
    // even when it's lifted towards the camera.
    const f = (this.dist - tipZ) / this.dist;
    this.pivot.position.set(px * f, py * f, tipZ);

    // Orient the rod: down-right on screen, rising off the glass.
    const a = (-(this.opts.angle + this.tiltNow) * Math.PI) / 180;
    const el = (this.opts.elevation * Math.PI) / 180;
    const yAxis = new THREE.Vector3(Math.sin(a) * Math.cos(el), -Math.cos(a) * Math.cos(el), Math.sin(el));
    const zAxis = new THREE.Vector3(0, 0, 1).addScaledVector(yAxis, -yAxis.z).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
    this.pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    this.pivot.scale.setScalar(s);

    this.sun.target.position.set(px, py, 0);
    this.sun.position.set(px + 120, py + 520, 760);

    const near = clamp(1 - z, 0, 1);
    this.blob.position.set(px, py, 0.2);
    this.blob.scale.setScalar(lerp(46, 22, near) * s);
    this.blob.material.opacity = lerp(0.12, 0.9, near);

    this.renderer.render(this.scene, this.camera);
  }
}

FingerCursor.hands = ['point', 'peace'];

// <script type="module" src="finger-cursor.js" data-auto data-hand="peace"></script>
const auto = typeof document !== 'undefined' &&
  document.querySelector('script[type="module"][src*="finger-cursor"][data-auto]');
if (auto) {
  const attr = (n) => auto.getAttribute(n) || undefined;
  FingerCursor.init({
    hand: attr('data-hand'),
    color: attr('data-color'),
    size: attr('data-size') ? parseFloat(attr('data-size')) : undefined,
    sound: attr('data-sound') === 'off' ? false : undefined
  });
}
