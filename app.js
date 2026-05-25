const VIEW_W = 1400;
const VIEW_H = 900;
const MICRO = [".", ".", ".", ".", ":", ":", "·"];
const ACCENTS = ["+", "=", "#", "%", "@"];
const PALETTES = {
  veil: ["#dfffee", "#bff7da", "#e8fff4", "#ffdce6", "#b9f7ff"],
  ember: ["#fff4df", "#f7e6c8", "#ffd7df", "#cdfbe3", "#d8ffff"],
  cyan: ["#d9ffff", "#b7f4ff", "#f4fff9", "#d9ffe8", "#ffe1ec"],
  rose: ["#ffe5ee", "#ffd2df", "#f5fff9", "#caffdf", "#d9f9ff"]
};

const els = {
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#fileInput"),
  emptyState: document.querySelector("#emptyState"),
  mount: document.querySelector("#renderMount"),
  canvas: document.querySelector("#analysisCanvas"),
  exportSvg: document.querySelector("#exportSvg"),
  exportPng: document.querySelector("#exportPng"),
  exportPngHi: document.querySelector("#exportPngHi"),
  controls: [...document.querySelectorAll("input[type='range'], select")]
};

const state = {
  image: null,
  imageName: "ascii-atmosphere",
  analysis: null,
  particles: [],
  svg: null,
  seed: 91273
};

window.__errors = [];
window.addEventListener("error", (event) => {
  window.__errors.push(event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  window.__errors.push(String(event.reason));
});

function getSettings() {
  const values = {};
  els.controls.forEach((el) => {
    values[el.id] = el.type === "range" ? Number(el.value) : el.value;
    const output = document.querySelector(`#${el.id}Value`);
    if (output && el.type === "range") output.textContent = Number(el.value).toFixed(2);
  });
  return values;
}

function mulberry32(seed) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function sanitizeName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "ascii-atmosphere";
}

function loadImage(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return;
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    state.image = img;
    state.imageName = sanitizeName(file.name);
    state.seed = [...file.name].reduce((acc, char) => acc + char.charCodeAt(0) * 17, file.size % 100000);
    analyzeImage();
    render();
  };
  img.src = URL.createObjectURL(file);
}

function analyzeImage() {
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const scale = Math.min(520 / state.image.width, 520 / state.image.height, 1);
  canvas.width = Math.max(80, Math.round(state.image.width * scale));
  canvas.height = Math.max(80, Math.round(state.image.height * scale));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const luminance = new Float32Array(canvas.width * canvas.height);
  let mean = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const a = data[i + 3] / 255;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a + (1 - a);
    luminance[p] = l;
    mean += l;
  }

  mean /= luminance.length;
  state.analysis = { width: canvas.width, height: canvas.height, luminance, mean };
}

function sampleLuma(x, y) {
  const { width, height, luminance } = state.analysis;
  const ix = clamp(Math.floor(x), 0, width - 1);
  const iy = clamp(Math.floor(y), 0, height - 1);
  return luminance[iy * width + ix];
}

function localEdge(x, y) {
  const a = sampleLuma(x - 1, y);
  const b = sampleLuma(x + 1, y);
  const c = sampleLuma(x, y - 1);
  const d = sampleLuma(x, y + 1);
  return clamp(Math.abs(a - b) + Math.abs(c - d), 0, 1);
}

function generateParticles(settings) {
  if (!state.analysis) return [];

  const rand = mulberry32(state.seed + Math.round(settings.density * 1000) + Math.round(settings.threshold * 100));
  const particles = [];
  const { width, height } = state.analysis;
  const imageRatio = width / height;
  const viewRatio = VIEW_W / VIEW_H;
  const fitted = imageRatio > viewRatio
    ? { w: VIEW_W * 0.82, h: (VIEW_W * 0.82) / imageRatio }
    : { h: VIEW_H * 0.82, w: VIEW_H * 0.82 * imageRatio };
  const ox = (VIEW_W - fitted.w) / 2;
  const oy = (VIEW_H - fitted.h) / 2;
  const maxParticles = Math.round(8800 * settings.density);
  const attempts = Math.round(maxParticles * 4.2);
  const palette = PALETTES[settings.palette];

  for (let i = 0; i < attempts && particles.length < maxParticles; i += 1) {
    const ix = rand() * width;
    const iy = rand() * height;
    const luma = sampleLuma(ix, iy);
    const darkness = clamp((settings.threshold - luma) / Math.max(settings.threshold, 0.01));
    const edge = localEdge(ix, iy);
    const body = Math.pow(darkness, 1.35);
    const atmospheric = Math.pow(1 - luma, 2.2) * 0.22;
    const acceptance = clamp(body + atmospheric + edge * 0.18);

    if (rand() > acceptance * (0.34 + settings.density * 0.46)) continue;

    const nx = ix / width;
    const ny = iy / height;
    const distanceFromCenter = Math.hypot(nx - 0.5, ny - 0.52);
    const dissolve = smoothstep(0.28, 0.72, distanceFromCenter) * settings.dissolve;
    if (rand() < dissolve * (1 - body * 0.45)) continue;

    const flow = (rand() - 0.5) * settings.diffusion * 72;
    const haze = Math.pow(rand(), 1.8) * settings.spread * 120;
    const angle = Math.atan2(ny - 0.48, nx - 0.5) + (rand() - 0.5) * 1.8;
    const x = ox + nx * fitted.w + Math.cos(angle) * haze + flow * 0.4;
    const y = oy + ny * fitted.h + Math.sin(angle) * haze + flow;
    const accentChance = Math.pow(body, 5) * 0.045;
    const char = rand() < accentChance ? ACCENTS[Math.floor(rand() * ACCENTS.length)] : MICRO[Math.floor(rand() * MICRO.length)];
    const size = settings.asciiSize * (0.72 + rand() * 0.62 + body * 0.28);
    const alpha = clamp(0.05 + body * 0.46 + edge * 0.13 - haze / 420, 0.025, 0.72);
    const color = palette[Math.floor(rand() * palette.length)];
    const rotate = (rand() - 0.5) * 12;

    particles.push({ x, y, char, size, alpha, color, rotate, body });
  }

  const hazeCount = Math.round(1250 * settings.spread * settings.density);
  for (let i = 0; i < hazeCount; i += 1) {
    const sideFade = Math.pow(rand(), 1.8);
    const x = VIEW_W * (0.15 + rand() * 0.7);
    const y = VIEW_H * (0.08 + rand() * 0.84);
    const char = MICRO[Math.floor(rand() * MICRO.length)];
    particles.push({
      x,
      y,
      char,
      size: settings.asciiSize * (0.55 + rand() * 0.45),
      alpha: 0.018 + sideFade * 0.055,
      color: palette[Math.floor(rand() * palette.length)],
      rotate: (rand() - 0.5) * 18,
      body: 0
    });
  }

  return particles;
}

function textNode(doc, particle, className = "particle") {
  const node = doc.createElementNS("http://www.w3.org/2000/svg", "text");
  node.setAttribute("class", className);
  node.setAttribute("x", particle.x.toFixed(2));
  node.setAttribute("y", particle.y.toFixed(2));
  node.setAttribute("font-size", particle.size.toFixed(2));
  node.setAttribute("fill", particle.color);
  node.setAttribute("fill-opacity", particle.alpha.toFixed(3));
  node.setAttribute("transform", `rotate(${particle.rotate.toFixed(2)} ${particle.x.toFixed(2)} ${particle.y.toFixed(2)})`);
  node.textContent = particle.char;
  return node;
}

function createSvg(settings, particles) {
  const doc = document.implementation.createHTMLDocument("");
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Volumetric ASCII particle rendering");
  svg.setAttribute("data-editable", "true");

  const defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <filter id="soft-bloom" x="-16%" y="-16%" width="132%" height="132%">
      <feGaussianBlur stdDeviation="${(settings.bloom * 2.6).toFixed(2)}" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${(settings.bloom * 0.48).toFixed(2)} 0" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="rgb-drift" x="-4%" y="-4%" width="108%" height="108%">
      <feOffset in="SourceGraphic" dx="-0.65" dy="0" result="r"/>
      <feOffset in="SourceGraphic" dx="0.65" dy="0" result="b"/>
      <feColorMatrix in="r" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .16 0" result="red"/>
      <feColorMatrix in="b" type="matrix" values="0 0 0 0 0 0 0.75 0 0 0 0 0 1 0 0 0 0 0 .12 0" result="blue"/>
      <feMerge><feMergeNode in="red"/><feMergeNode in="blue"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="scanline-pattern" width="1" height="4" patternUnits="userSpaceOnUse">
      <rect width="1" height="1" fill="#ffffff" opacity="${settings.scanlines.toFixed(3)}"/>
    </pattern>
  `;
  svg.appendChild(defs);

  const bg = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("id", "black-background");
  bg.setAttribute("width", VIEW_W);
  bg.setAttribute("height", VIEW_H);
  bg.setAttribute("fill", "#010202");
  svg.appendChild(bg);

  const glow = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  glow.setAttribute("id", "soft-crt-bloom");
  glow.setAttribute("filter", "url(#soft-bloom)");
  particles.filter((p) => p.alpha > 0.3 && p.body > 0.45).forEach((p) => {
    const duplicate = { ...p, alpha: p.alpha * 0.42, size: p.size * 1.14 };
    glow.appendChild(textNode(doc, duplicate, "bloom-particle"));
  });
  svg.appendChild(glow);

  const field = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  field.setAttribute("id", "editable-ascii-particle-field");
  field.setAttribute("filter", "url(#rgb-drift)");
  field.setAttribute("font-family", "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
  field.setAttribute("text-anchor", "middle");
  field.setAttribute("dominant-baseline", "middle");
  particles.forEach((particle) => field.appendChild(textNode(doc, particle)));
  svg.appendChild(field);

  const scan = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  scan.setAttribute("id", "subtle-scanlines");
  scan.setAttribute("width", VIEW_W);
  scan.setAttribute("height", VIEW_H);
  scan.setAttribute("fill", "url(#scanline-pattern)");
  scan.setAttribute("opacity", "0.32");
  scan.setAttribute("mix-blend-mode", "screen");
  svg.appendChild(scan);

  const texture = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  texture.setAttribute("id", "signal-noise");
  texture.setAttribute("font-family", "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
  texture.setAttribute("text-anchor", "middle");
  texture.setAttribute("dominant-baseline", "middle");
  const rand = mulberry32(state.seed + 4433);
  for (let i = 0; i < 260; i += 1) {
    texture.appendChild(textNode(doc, {
      x: rand() * VIEW_W,
      y: rand() * VIEW_H,
      char: rand() > 0.74 ? ":" : ".",
      size: 3 + rand() * 3,
      alpha: 0.018 + rand() * 0.035,
      color: PALETTES[settings.palette][Math.floor(rand() * PALETTES[settings.palette].length)],
      rotate: 0
    }, "signal-speck"));
  }
  svg.appendChild(texture);

  return svg;
}

function render() {
  if (!state.image || !state.analysis) return;
  const settings = getSettings();
  state.particles = generateParticles(settings);
  state.svg = createSvg(settings, state.particles);
  els.mount.replaceChildren(state.svg);
  els.emptyState.style.display = "none";
  [els.exportSvg, els.exportPng, els.exportPngHi].forEach((button) => (button.disabled = false));
}

function serializeSvg(includeBackground = true) {
  const clone = state.svg.cloneNode(true);
  if (!includeBackground) clone.querySelector("#black-background")?.remove();
  clone.setAttribute("width", VIEW_W);
  clone.setAttribute("height", VIEW_H);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportSvg() {
  const blob = new Blob([serializeSvg(true)], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, `${state.imageName}-atmospheric-ascii.svg`);
}

function exportPng(scale = 2) {
  const svgMarkup = serializeSvg(false);
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(VIEW_W * scale);
    canvas.height = Math.round(VIEW_H * scale);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${state.imageName}-transparent-ascii-${scale > 2 ? "4k" : "png"}.png`);
      URL.revokeObjectURL(url);
    }, "image/png");
  };
  img.src = url;
}

let renderTimer = 0;
els.controls.forEach((el) => {
  el.addEventListener("input", () => {
    getSettings();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 90);
  });
});

els.fileInput.addEventListener("change", (event) => loadImage(event.target.files[0]));
els.exportSvg.addEventListener("click", exportSvg);
els.exportPng.addEventListener("click", () => exportPng(2));
els.exportPngHi.addEventListener("click", () => exportPng(3840 / VIEW_W));

["dragenter", "dragover"].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("is-dragging");
  });
});

els.dropzone.addEventListener("drop", (event) => {
  loadImage(event.dataTransfer.files[0]);
});

getSettings();

async function loadDemoImage() {
  const c = document.createElement("canvas");
  c.width = 720;
  c.height = 960;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, "#eeeeee");
  g.addColorStop(0.5, "#3b3b3b");
  g.addColorStop(1, "#080808");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#090909";
  ctx.beginPath();
  ctx.ellipse(360, 265, 92, 118, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(360, 370);
  ctx.bezierCurveTo(240, 410, 250, 705, 305, 865);
  ctx.bezierCurveTo(374, 905, 485, 862, 487, 700);
  ctx.bezierCurveTo(491, 540, 465, 410, 360, 370);
  ctx.fill();
  ctx.strokeStyle = "#101010";
  ctx.lineWidth = 35;
  ctx.beginPath();
  ctx.moveTo(298, 485);
  ctx.bezierCurveTo(190, 545, 170, 670, 120, 765);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(430, 498);
  ctx.bezierCurveTo(560, 565, 590, 635, 642, 742);
  ctx.stroke();
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  loadImage(new File([blob], "sample-silhouette.png", { type: "image/png" }));
}

if (new URLSearchParams(window.location.search).has("demo")) {
  loadDemoImage().catch((error) => {
    window.__errors.push(error.message);
  });
}
