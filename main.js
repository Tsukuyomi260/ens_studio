import * as THREE from "three";

/* ===========================================================================
   Studio ENS

   The hero is a scroll-scrubbed image sequence (frames extracted from the
   source render). Frames instead of a live <video> keeps scrubbing smooth in
   both directions and sidesteps browser seek limitations.

   The source frames are shot on a white plate and carry a watermark in the
   bottom-right corner. The shader keys the plate out by luminance and
   un-premultiplies the result against known white, so the subject composites
   cleanly onto the page background with no light fringe — and the watermark
   (a pale grey on white) keys out along with the plate.
   =========================================================================== */

const FRAME_COUNT = 97;
const FRAME_ASPECT = 1; // square source
const framePath = (i) => `./frames/frame_${String(i).padStart(3, "0")}.webp`; // 1-based, lossless

/* Scrub smoothing. 1 = locked to scroll, lower = more glide. */
const SCRUB_EASE = 0.14;

/* Luma key thresholds, in 0..1 luminance.
   Above KEY_HI  → fully transparent (plate AND the contact shadow)
   Below KEY_LO  → fully opaque (the subject)
   Between       → a thin anti-alias ramp only.
   Measured on this plate: camera < 0.35, contact shadow 0.48–0.59, plate 0.95+.
   Thresholds sit between the camera and the shadow so the shadow keys out too. */
const KEY_HI = 0.46;
const KEY_LO = 0.36;

/* Luminance of the source plate, used as the un-premultiply reference. */
const PLATE = 1.0;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ===========================================================================
   Renderer
   =========================================================================== */

const canvas = document.getElementById("scene");
const stage = document.querySelector(".stage");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  premultipliedAlpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const texture = new THREE.Texture();
texture.minFilter = THREE.LinearFilter;
texture.magFilter = THREE.LinearFilter;
texture.wrapS = THREE.ClampToEdgeWrapping;
texture.wrapT = THREE.ClampToEdgeWrapping;
texture.generateMipmaps = false;
texture.colorSpace = THREE.SRGBColorSpace;

const material = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTex: { value: texture },
    uRes: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: FRAME_ASPECT },
    uScale: { value: 0.92 },
    uOffset: { value: new THREE.Vector2(0.14, -0.02) },
    uFade: { value: 0 },
    uKeyHi: { value: KEY_HI },
    uKeyLo: { value: KEY_LO },
    uPlate: { value: PLATE },
    // 1 / frame resolution — texel step for the sharpen taps.
    uTexel: { value: new THREE.Vector2(1 / 1080, 1 / 1080) },
    // Unsharp amount. Counters the softness of magnifying a 1080 source on
    // hi-DPI displays. Kept low so keyed edges don't ring.
    uSharp: { value: 0.28 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D uTex;
    uniform vec2  uRes;
    uniform float uAspect;
    uniform float uScale;
    uniform vec2  uOffset;
    uniform float uFade;
    uniform float uKeyHi;
    uniform float uKeyLo;
    uniform float uPlate;
    uniform vec2  uTexel;
    uniform float uSharp;

    varying vec2 vUv;

    void main() {
      float S = uRes.x / uRes.y;
      float A = uAspect;

      // "contain" fit — the whole frame stays visible, then uScale/uOffset
      // place the subject in the composition.
      vec2 fit = vec2(max(1.0, S / A), max(1.0, A / S));
      vec2 uv = (vUv - 0.5 - uOffset) * fit / uScale + 0.5;

      // outside the frame contributes nothing
      vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
      float mask = inside.x * inside.y;

      vec3 src = texture2D(uTex, uv).rgb;

      // Unsharp mask (4-tap) — sharpen the colour only. The alpha key below is
      // computed from the ORIGINAL luma so sharpening cannot move the shadow /
      // plate threshold and reintroduce a shadow.
      vec3 nb = texture2D(uTex, uv + vec2(uTexel.x, 0.0)).rgb
              + texture2D(uTex, uv - vec2(uTexel.x, 0.0)).rgb
              + texture2D(uTex, uv + vec2(0.0, uTexel.y)).rgb
              + texture2D(uTex, uv - vec2(0.0, uTexel.y)).rgb;
      vec3 sharp = clamp(src + uSharp * (4.0 * src - nb), 0.0, 1.0);

      float luma = dot(src, vec3(0.2126, 0.7152, 0.0722));

      // white plate -> 0, subject -> 1
      float a = smoothstep(uKeyHi, uKeyLo, luma) * mask;

      // Un-premultiply against the known plate colour. Without this, the
      // antialiased edges of the subject keep a white halo once composited
      // over a background that is not exactly the plate.
      vec3 col = clamp((sharp - (1.0 - a) * uPlate) / max(a, 0.001), 0.0, 1.0);

      gl_FragColor = vec4(col, a * uFade);
    }
  `,
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);

/* ---- Sizing & composition -------------------------------------------------
   The subject sits right-of-centre on wide screens so the headline owns the
   left column, and drops to centre-low on narrow ones where the copy stacks. */

function layout() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;

  renderer.setSize(w, h, false);
  material.uniforms.uRes.value.set(w, h);

  const narrow = window.innerWidth < 860;
  if (narrow) {
    material.uniforms.uScale.value = 0.98;
    material.uniforms.uOffset.value.set(0, -0.13);
  } else {
    material.uniforms.uScale.value = 0.92;
    material.uniforms.uOffset.value.set(0.14, -0.02);
  }
}

if ("ResizeObserver" in window) {
  new ResizeObserver(layout).observe(canvas);
} else {
  window.addEventListener("resize", layout);
}
layout();

/* ===========================================================================
   Preload
   =========================================================================== */

const loaderEl = document.getElementById("loader");
const loaderBar = document.getElementById("loader-bar");
const loaderPct = document.getElementById("loader-pct");

const frames = new Array(FRAME_COUNT);
let loadedCount = 0;
let ready = false;

function onFrameSettled() {
  loadedCount++;
  const pct = loadedCount / FRAME_COUNT;
  if (loaderBar) loaderBar.style.transform = `scaleX(${pct})`;
  if (loaderPct) loaderPct.textContent = `${Math.round(pct * 100)} %`;
  if (loadedCount === FRAME_COUNT) start();
}

for (let i = 0; i < FRAME_COUNT; i++) {
  const img = new Image();
  img.decoding = "async";
  img.onload = onFrameSettled;
  // A missing frame must not stall the whole page behind the loader.
  img.onerror = onFrameSettled;
  img.src = framePath(i + 1);
  frames[i] = img;
}

function start() {
  ready = true;
  texture.image = frames[0];
  texture.needsUpdate = true;
  loaderEl.classList.add("is-hidden");
  setTimeout(() => loaderEl.remove(), 600);
}

/* Never leave a visitor stuck on the loader if the network stalls. */
setTimeout(() => { if (!ready) start(); }, 12000);

/* ===========================================================================
   Scroll → frame index
   Progress is measured against the stage element, not the document, so
   adding sections below the hero cannot change the scrub range.
   =========================================================================== */

let progress = 0;
let targetFrame = 0;
let curFrame = 0;
let shownFrame = -1;

function stageProgress() {
  const r = stage.getBoundingClientRect();
  const travel = r.height - window.innerHeight;
  if (travel <= 0) return 0;
  return clamp(-r.top / travel, 0, 1);
}

/* ---- Overlay state driven by the same progress value ---- */

const heroEl = document.getElementById("hero");
const cueEl = document.getElementById("scroll-cue");
const chapterEls = [...document.querySelectorAll(".chapter")];

const CHAPTER_STOPS = [0.22, 0.46, 0.7]; // progress at which each caption takes over
let activeChapter = -1;

function paintOverlay(p) {
  // Hero clears out as soon as the sequence starts moving.
  const out = smoothstep(0.02, 0.17, p);
  heroEl.style.opacity = String(1 - out);
  heroEl.style.transform = reduceMotion.matches
    ? "none"
    : `translate3d(0, ${-out * 34}px, 0)`;
  heroEl.style.pointerEvents = out > 0.6 ? "none" : "";

  if (cueEl) cueEl.classList.toggle("is-hidden", p > 0.02);

  let next = -1;
  for (let i = 0; i < CHAPTER_STOPS.length; i++) {
    if (p >= CHAPTER_STOPS[i]) next = i;
  }
  if (next !== activeChapter) {
    activeChapter = next;
    chapterEls.forEach((el, i) => el.classList.toggle("is-active", i === next));
  }
}

function onScroll() {
  progress = stageProgress();
  targetFrame = progress * (FRAME_COUNT - 1);
  paintOverlay(progress);
}
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);
onScroll();

/* ===========================================================================
   Render loop — parked while the stage is off-screen
   =========================================================================== */

let stageVisible = true;
new IntersectionObserver(
  ([entry]) => { stageVisible = entry.isIntersecting; },
  { rootMargin: "10% 0px" }
).observe(stage);

function tick() {
  requestAnimationFrame(tick);
  if (!ready || !stageVisible) return;

  const ease = reduceMotion.matches ? 1 : SCRUB_EASE;
  curFrame += (targetFrame - curFrame) * ease;

  const idx = clamp(Math.round(curFrame), 0, FRAME_COUNT - 1);
  if (idx !== shownFrame) {
    shownFrame = idx;
    texture.image = frames[idx];
    texture.needsUpdate = true;
  }

  const uFade = material.uniforms.uFade;
  if (uFade.value < 1) uFade.value = Math.min(1, uFade.value + 0.04);

  renderer.render(scene, camera);
}
tick();

/* ===========================================================================
   Header state
   =========================================================================== */

const header = document.getElementById("site-header");
let stuck = false;

window.addEventListener(
  "scroll",
  () => {
    const next = window.scrollY > 12;
    if (next !== stuck) {
      stuck = next;
      header.classList.toggle("is-stuck", next);
    }
  },
  { passive: true }
);

/* ===========================================================================
   Active nav link
   =========================================================================== */

const navLinks = [...document.querySelectorAll(".nav__link")];
const sectionIds = navLinks
  .map((a) => a.getAttribute("href"))
  .filter((h) => h && h.startsWith("#"));

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((a) =>
        a.classList.toggle("is-active", a.getAttribute("href") === `#${entry.target.id}`)
      );
    });
  },
  // a band across the middle of the viewport decides which section is "current"
  { rootMargin: "-45% 0px -45% 0px" }
);

sectionIds.forEach((id) => {
  const el = document.querySelector(id);
  if (el) sectionObserver.observe(el);
});

/* ===========================================================================
   Scroll reveals
   =========================================================================== */

const revealObserver = new IntersectionObserver(
  (entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      obs.unobserve(entry.target); // reveal once, never replay on scroll-back
    });
  },
  { rootMargin: "0px 0px -100px 0px" }
);

document.querySelectorAll("[data-reveal]").forEach((el) => revealObserver.observe(el));

/* ===========================================================================
   Mobile navigation
   =========================================================================== */

const menuToggle = document.getElementById("menu-toggle");
const mobileNav = document.getElementById("mobile-nav");
let menuOpen = false;
let menuTimer;

function setMenu(open) {
  if (open === menuOpen) return;
  menuOpen = open;

  clearTimeout(menuTimer);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
  document.body.classList.toggle("is-locked", open);

  if (open) {
    mobileNav.hidden = false;
    // one frame with the element laid out but still in its start state,
    // otherwise the browser has nothing to transition from
    requestAnimationFrame(() => mobileNav.classList.add("is-open"));
  } else {
    mobileNav.classList.remove("is-open");
    menuTimer = setTimeout(() => { mobileNav.hidden = true; }, 260);
  }
}

menuToggle.addEventListener("click", () => setMenu(!menuOpen));
mobileNav.addEventListener("click", (e) => {
  if (e.target.closest("a")) setMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menuOpen) setMenu(false);
});
window.addEventListener("resize", () => {
  if (window.innerWidth >= 860) setMenu(false);
});

/* ===========================================================================
   Contact form
   No backend here — the submit composes a mail draft. Swap this for a real
   endpoint (Formspree, Resend, a serverless handler) before going live.
   =========================================================================== */

const form = document.getElementById("contact-form");
const formNote = document.getElementById("form-note");
const MAILTO = "bonjour@studio-ens.fr";

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  const email = String(data.get("email") || "").trim();
  const message = String(data.get("message") || "").trim();
  const scope = data.getAll("scope");

  const invalid = [];
  if (!name) invalid.push(form.elements.name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid.push(form.elements.email);
  if (!message) invalid.push(form.elements.message);

  [form.elements.name, form.elements.email, form.elements.message].forEach((el) =>
    el.removeAttribute("aria-invalid")
  );

  if (invalid.length) {
    invalid.forEach((el) => el.setAttribute("aria-invalid", "true"));
    formNote.textContent = "Merci de compléter les champs manquants.";
    formNote.className = "form__note is-error";
    invalid[0].focus();
    return;
  }

  const subject = `Projet — ${name}${scope.length ? ` (${scope.join(", ")})` : ""}`;
  const body = [
    `Nom : ${name}`,
    `E-mail : ${email}`,
    scope.length ? `Type : ${scope.join(", ")}` : null,
    "",
    message,
  ]
    .filter(Boolean)
    .join("\n");

  window.location.href =
    `mailto:${MAILTO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  formNote.textContent = "Votre logiciel de messagerie s’ouvre…";
  formNote.className = "form__note is-ok";
});

/* ===========================================================================
   Misc
   =========================================================================== */

document.getElementById("year").textContent = String(new Date().getFullYear());

/* ===========================================================================
   Showreel — swap the poster button for a real <video> on first click.
   Nothing about the clip is fetched until the visitor asks for it.
   =========================================================================== */

const reelBtn = document.getElementById("reel-btn");
if (reelBtn) {
  reelBtn.addEventListener(
    "click",
    () => {
      const v = document.createElement("video");
      v.src = "./assets/showreel.mp4";
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.preload = "auto";
      reelBtn.replaceWith(v);
      v.play().catch(() => {});
    },
    { once: true }
  );
}

/* ===========================================================================
   Contact form → WhatsApp. On submit we compose the message from the fields
   and open a wa.me chat, prefilled. No backend, no mailbox needed.
   =========================================================================== */

const WHATSAPP_NUMBER = "2290144387642"; // +229, sans le +

const contactForm = document.getElementById("contact-form");
const formNote = document.getElementById("form-note");

if (contactForm) {
  const setNote = (msg) => {
    if (formNote) formNote.textContent = msg;
  };

  contactForm.addEventListener("submit", (e) => {
    e.preventDefault();

    if (!contactForm.checkValidity()) {
      contactForm.reportValidity();
      return;
    }

    const fd = new FormData(contactForm);
    const name = (fd.get("name") || "").toString().trim();
    const email = (fd.get("email") || "").toString().trim();
    const scopes = fd.getAll("scope").join(", ") || "—";
    const message = (fd.get("message") || "").toString().trim();

    const text =
      `Bonjour Studio ENS 👋\n\n` +
      `Nom : ${name}\n` +
      `E-mail : ${email}\n` +
      `Type : ${scopes}\n\n` +
      `Projet :\n${message}`;

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
    setNote("Ouverture de WhatsApp…");
    window.open(url, "_blank", "noopener");
  });
}
