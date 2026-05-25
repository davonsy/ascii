const VIEW_W = 1400;
const VIEW_H = 900;
const LETTERS_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LETTERS_LOWER = "abcdefghijklmnopqrstuvwxyz";
const SYMBOL_CORE = ["@", "%", "#", "+", "=", "*"];
const DECORATIVE = ["★", "☆", "♣", "♧", "⚡", "♥", "♡"];
const vibrantColors = ["#90e06d", "#f7d147", "#ff4fd8", "#44d7ff", "#ff5a3d", "#b78cff", "#ffffff"];
const cursorSymbols = ["☆", "✧", "⚡", "♧"];
const ASCII_BANDS = {
  dense: ["@", "%", "#", "M", "W", "B", "Q", "8"],
  mid: ["A", "H", "K", "X", "Z", "U", "V", "Y"],
  light: ["+", "=", "*", ":", ";", "~", "-", "."]
};
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
  previewPanel: document.querySelector("#previewPanel"),
  originalPreview: document.querySelector("#originalPreview"),
  imageMeta: document.querySelector("#imageMeta"),
  statusLine: document.querySelector("#statusLine"),
  errorLine: document.querySelector("#errorLine"),
  mount: document.querySelector("#renderMount"),
  artworkViewport: document.querySelector("#artworkViewport"),
  artworkCamera: document.querySelector("#artworkCamera"),
  resetView: document.querySelector("#resetView"),
  changeSource: document.querySelector("#changeSource"),
  canvas: document.querySelector("#analysisCanvas"),
  matrixRain: document.querySelector("#matrixRain"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  loadingTerminal: document.querySelector("#loadingTerminal"),
  loadingPercent: document.querySelector("#loadingPercent"),
  loadingGauge: document.querySelector("#loadingGauge"),
  cursorParticles: document.querySelector("#cursorParticles"),
  brandButton: document.querySelector("#brandButton"),
  portfolioLink: document.querySelector("#portfolioLink"),
  exportSvg: document.querySelector("#exportSvg"),
  exportPng: document.querySelector("#exportPng"),
  exportPngHi: document.querySelector("#exportPngHi"),
  controls: [...document.querySelectorAll("input[type='range'], select")]
};

const state = {
  image: null,
  imageName: "ascii-atmosphere",
  analysis: null,
  rows: [],
  svg: null,
  seed: 91273,
  processId: 0,
  objectUrl: "",
  preview: {
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    lastX: 0,
    lastY: 0
  }
};

window.__errors = [];
window.addEventListener("error", (event) => {
  window.__errors.push(event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  window.__errors.push(String(event.reason));
});

function logPipeline(message, data) {
  if (data === undefined) {
    console.log(`[ascii-renderer] ${message}`);
  } else {
    console.log(`[ascii-renderer] ${message}`, data);
  }
}

function setStatus(message) {
  els.statusLine.textContent = message || "";
}

function showError(message, error) {
  els.errorLine.textContent = message || "";
  if (error) {
    console.error("[ascii-renderer] full error", error);
    window.__errors.push(error.stack || error.message || String(error));
  }
}

function setBusy(isBusy) {
  els.dropzone.classList.toggle("is-processing", isBusy);
  els.fileInput.disabled = isBusy;
}

function resetOutput() {
  state.image = null;
  state.analysis = null;
  state.rows = [];
  state.svg = null;
  resetPreviewView();
  els.previewPanel.hidden = true;
  els.originalPreview.removeAttribute("src");
  els.imageMeta.textContent = "";
  els.artworkCamera.replaceChildren();
  els.mount.classList.remove("has-artwork");
  els.dropzone.classList.remove("has-output");
  els.emptyState.style.display = "grid";
  els.errorLine.textContent = "";
  setStatus("");
  [els.exportSvg, els.exportPng, els.exportPngHi].forEach((button) => (button.disabled = true));
}

function getSettings() {
  const values = {};
  els.controls.forEach((el) => {
    values[el.id] = el.type === "range" ? Number(el.value) : el.value;
    const output = document.querySelector(`#${el.id}Value`);
    if (output && el.type === "range") {
      output.textContent = el.id === "colorRandomness"
        ? `${Math.round(Number(el.value))}%`
        : Number(el.value).toFixed(2);
    }
  });
  return values;
}

function resetControlsToDefaults() {
  els.controls.forEach((el) => {
    if (el.tagName === "SELECT") {
      const selected = [...el.options].find((option) => option.defaultSelected) || el.options[0];
      if (selected) el.value = selected.value;
    } else {
      el.value = el.getAttribute("value") || el.defaultValue || el.value;
    }
  });
}

function applyPreviewView() {
  els.artworkCamera.style.setProperty("--zoom", state.preview.zoom.toFixed(4));
  els.artworkCamera.style.setProperty("--pan-x", `${state.preview.panX.toFixed(2)}px`);
  els.artworkCamera.style.setProperty("--pan-y", `${state.preview.panY.toFixed(2)}px`);
  els.resetView.hidden = !state.svg || (Math.abs(state.preview.zoom - 1) < 0.001 && Math.abs(state.preview.panX) < 0.5 && Math.abs(state.preview.panY) < 0.5);
}

function resetPreviewView() {
  state.preview.zoom = 1;
  state.preview.panX = 0;
  state.preview.panY = 0;
  state.preview.isPanning = false;
  els.mount.classList.remove("is-panning");
  applyPreviewView();
}

function zoomPreview(event) {
  if (!state.svg) return;
  event.preventDefault();

  const rect = els.artworkViewport.getBoundingClientRect();
  const pointerX = event.clientX - rect.left - rect.width / 2;
  const pointerY = event.clientY - rect.top - rect.height / 2;
  const previousZoom = state.preview.zoom;
  const zoomFactor = Math.exp(-event.deltaY * 0.0018);
  const nextZoom = clamp(previousZoom * zoomFactor, 0.25, 4);
  if (Math.abs(nextZoom - previousZoom) < 0.001) return;

  const ratio = nextZoom / previousZoom;
  state.preview.panX = pointerX - (pointerX - state.preview.panX) * ratio;
  state.preview.panY = pointerY - (pointerY - state.preview.panY) * ratio;
  state.preview.zoom = nextZoom;
  applyPreviewView();
}

function startPreviewPan(event) {
  if (!state.svg || event.button !== 0) return;
  state.preview.isPanning = true;
  state.preview.lastX = event.clientX;
  state.preview.lastY = event.clientY;
  els.mount.classList.add("is-panning");
  els.artworkViewport.setPointerCapture?.(event.pointerId);
}

function movePreviewPan(event) {
  if (!state.preview.isPanning) return;
  const dx = event.clientX - state.preview.lastX;
  const dy = event.clientY - state.preview.lastY;
  state.preview.lastX = event.clientX;
  state.preview.lastY = event.clientY;
  state.preview.panX += dx;
  state.preview.panY += dy;
  applyPreviewView();
}

function endPreviewPan(event) {
  if (!state.preview.isPanning) return;
  state.preview.isPanning = false;
  els.mount.classList.remove("is-panning");
  els.artworkViewport.releasePointerCapture?.(event.pointerId);
}

function runLoadingScreen() {
  if (!els.loadingOverlay || !els.loadingPercent || !els.loadingGauge || !els.loadingTerminal) return;
  let frame = 0;
  let start = 0;
  const rainIntroDuration = 1900;

  els.loadingOverlay.classList.remove("is-complete");
  els.loadingOverlay.setAttribute("aria-hidden", "false");
  els.loadingPercent.textContent = "000%";
  els.loadingGauge.style.setProperty("--loading-progress", "0%");
  els.loadingTerminal.setAttribute("aria-label", "Loading 0%");
  document.body.classList.add("intro-scroll-locked");

  const unlockIntro = () => {
    els.loadingPercent.textContent = "100%";
    els.loadingGauge.style.setProperty("--loading-progress", "100%");
    els.loadingTerminal.setAttribute("aria-label", "Loading 100%");
    els.loadingOverlay.classList.add("is-complete");
    window.setTimeout(() => {
      document.body.classList.remove("intro-scroll-locked");
      els.loadingOverlay.setAttribute("aria-hidden", "true");
    }, 750);
  };

  const animateLoading = (time) => {
    if (!start) start = time;
    const progress = clamp((time - start) / rainIntroDuration);
    const eased = easeInOutCubic(progress);
    const percentage = Math.min(100, Math.round(eased * 100));

    els.loadingPercent.textContent = `${String(percentage).padStart(3, "0")}%`;
    els.loadingGauge.style.setProperty("--loading-progress", `${percentage}%`);
    els.loadingTerminal.setAttribute("aria-label", `Loading ${percentage}%`);

    if (progress < 1) {
      frame = window.requestAnimationFrame(animateLoading);
      return;
    }

    unlockIntro();
  };

  frame = window.requestAnimationFrame(animateLoading);
  window.addEventListener("pagehide", () => window.cancelAnimationFrame(frame), { once: true });
}

function initLoadingScreen() {
  window.replayDavonsyLoading = runLoadingScreen;
  runLoadingScreen();
}

function initMatrixRain() {
  const canvas = els.matrixRain;
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const symbols = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+-=<>/?";
  const palette = ["#90e06d", "#44d7ff", "#f7d147", "#ff4fd8", "#b78cff", "#ffffff"];
  const fontSize = 15;
  let columns = [];
  let frame = 0;
  let raf = 0;
  let width = 0;
  let height = 0;

  const resize = () => {
    const pixelRatio = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    columns = Array.from({ length: Math.ceil(width / fontSize) }, () => ({
      y: Math.random() * -height,
      speed: 0.16 + Math.random() * 0.38,
      colorOffset: Math.floor(Math.random() * palette.length),
      glitch: Math.random()
    }));
  };

  const draw = () => {
    context.fillStyle = "rgba(0, 0, 0, 0.085)";
    context.fillRect(0, 0, width, height);
    context.font = `${fontSize}px Inter, monospace`;
    context.textAlign = "center";

    columns.forEach((column, index) => {
      const isGlitchFrame = column.glitch > 0.86 && frame % 48 < 3;
      const character = symbols[Math.floor(Math.random() * symbols.length)];
      const color = palette[(Math.floor(frame / 72) + column.colorOffset + index) % palette.length];
      const x = index * fontSize + fontSize / 2;

      context.fillStyle = isGlitchFrame ? "#ffffff" : color;
      context.globalAlpha = isGlitchFrame ? 0.72 : 0.18 + Math.random() * 0.36;
      context.fillText(character, x, column.y);

      if (isGlitchFrame) {
        context.globalAlpha = 0.18;
        context.fillText(character, x + 4, column.y);
      }

      column.y += fontSize * column.speed;
      if (column.y > height + Math.random() * 220) {
        column.y = -Math.random() * height * 0.45;
        column.speed = 0.16 + Math.random() * 0.38;
        column.colorOffset = Math.floor(Math.random() * palette.length);
        column.glitch = Math.random();
      }
    });

    context.globalAlpha = 1;
    frame += 1;
    raf = window.requestAnimationFrame(draw);
  };

  resize();
  raf = window.requestAnimationFrame(draw);
  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  }, { once: true });
}

function initCursorParticles() {
  if (!els.cursorParticles) return;

  let lastSpawn = 0;
  const active = new Map();

  const removeParticle = (id) => {
    const node = active.get(id);
    if (node) {
      node.remove();
      active.delete(id);
    }
  };

  const handlePointerMove = (event) => {
    const now = performance.now();
    if (now - lastSpawn < 70) return;
    lastSpawn = now;

    const clusterSize = 2 + Math.floor(Math.random() * 3);
    const cluster = Array.from({ length: clusterSize }, (_, index) => ({
      id: `${now}-${index}-${Math.random()}`,
      symbol: cursorSymbols[Math.floor(Math.random() * cursorSymbols.length)],
      color: vibrantColors[Math.floor(Math.random() * vibrantColors.length)],
      x: event.clientX + (Math.random() - 0.5) * 34,
      y: event.clientY + (Math.random() - 0.5) * 34,
      driftX: (Math.random() - 0.5) * 42,
      driftY: (Math.random() - 0.5) * 42,
      rotate: (Math.random() - 0.5) * 92,
      size: 10 + Math.random() * 8
    }));

    cluster.forEach((particle) => {
      const node = document.createElement("span");
      node.style.setProperty("--particle-color", particle.color);
      node.style.setProperty("--particle-x", `${particle.x}px`);
      node.style.setProperty("--particle-y", `${particle.y}px`);
      node.style.setProperty("--particle-drift-x", `${particle.driftX}px`);
      node.style.setProperty("--particle-drift-y", `${particle.driftY}px`);
      node.style.setProperty("--particle-rotate", `${particle.rotate}deg`);
      node.style.setProperty("--particle-size", `${particle.size}px`);
      node.textContent = particle.symbol;
      els.cursorParticles.appendChild(node);
      active.set(particle.id, node);
      window.setTimeout(() => removeParticle(particle.id), 1050);
    });

    while (active.size > 32) {
      removeParticle(active.keys().next().value);
    }
  };

  window.addEventListener("pointermove", handlePointerMove, { passive: true });
  window.addEventListener("pagehide", () => window.removeEventListener("pointermove", handlePointerMove), { once: true });
}

function mulberry32(seed) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2d(x, y, seed = 0) {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 2246822519, 3266489917) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value ** 3 : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function sanitizeName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "ascii-atmosphere";
}

function isSupportedImage(file) {
  if (!file) return false;
  const validType = /^image\/(png|jpe?g|webp)$/i.test(file.type);
  const validName = /\.(png|jpe?g|webp)$/i.test(file.name || "");
  return validType || validName;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The selected image could not be decoded."));
    img.src = src;
  });
}

async function loadImage(file) {
  const processId = ++state.processId;
  resetOutput();
  resetPreviewView();

  try {
    if (!file) throw new Error("No image file was selected.");
    if (!isSupportedImage(file)) throw new Error("Please upload a PNG, JPG, JPEG, or WebP image.");

    logPipeline("file selected", { name: file.name, type: file.type || "unknown", size: file.size });
    setBusy(true);
    setStatus("loading source image");
    state.imageName = sanitizeName(file.name);
    state.seed = [...file.name].reduce((acc, char) => acc + char.charCodeAt(0) * 17, file.size % 100000);

    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    els.originalPreview.src = state.objectUrl;
    els.previewPanel.hidden = false;
    els.imageMeta.textContent = `${Math.round(file.size / 1024)} KB`;

    const dataUrl = await readFileAsDataUrl(file);
    if (processId !== state.processId) return;
    const img = await decodeImage(dataUrl);
    if (processId !== state.processId) return;

    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error("The decoded image has no readable dimensions.");
    }

    logPipeline("image loaded", { width: img.naturalWidth, height: img.naturalHeight });
    els.imageMeta.textContent = `${img.naturalWidth} x ${img.naturalHeight} · ${Math.round(file.size / 1024)} KB`;
    state.image = img;
    await processCurrentImage();
  } catch (error) {
    showError(error.message || "Image processing failed.", error);
    setStatus("");
  } finally {
    if (processId === state.processId) setBusy(false);
    els.fileInput.value = "";
  }
}

async function processCurrentImage() {
  try {
    setStatus("converting image to ASCII rows");
    logPipeline("processing started");
    analyzeImage();
    render();
    logPipeline("processing completed", {
      rows: state.rows.length,
      canvas: state.analysis ? `${state.analysis.width}x${state.analysis.height}` : "none"
    });
    setStatus("ASCII preview generated");
  } catch (error) {
    showError(error.message || "Processing failed.", error);
    setStatus("");
  }
}

function analyzeImage() {
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas could not be created in this browser.");
  if (!state.image || !state.image.naturalWidth || !state.image.naturalHeight) {
    throw new Error("Image dimensions are invalid.");
  }

  const scale = Math.min(520 / state.image.width, 520 / state.image.height, 1);
  canvas.width = Math.max(80, Math.round(state.image.width * scale));
  canvas.height = Math.max(80, Math.round(state.image.height * scale));
  if (!canvas.width || !canvas.height) throw new Error("Canvas dimensions are empty.");
  logPipeline("canvas created", { width: canvas.width, height: canvas.height });

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (!imageData || !imageData.data || !imageData.data.length) {
    throw new Error("Canvas processing returned empty image data.");
  }
  const { data } = imageData;
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

function adjustedLuma(luma, settings) {
  const contrast = settings.contrast ?? 1;
  const brightness = settings.brightness ?? 0;
  const value = clamp((luma - 0.5) * contrast + 0.5 + brightness);
  return settings.invert === "on" ? 1 - value : value;
}

function pickFrom(list, value) {
  return list[Math.min(list.length - 1, Math.floor(value * list.length))];
}

function mixedBand(base, letters, symbols, alphabetAmount, symbolDensity, roll) {
  const pool = [...base];
  const letterCount = Math.round(letters.length * alphabetAmount);
  const symbolCount = Math.max(1, Math.round(symbols.length * symbolDensity));
  for (let i = 0; i < letterCount; i += 1) pool.push(letters[i % letters.length]);
  for (let i = 0; i < symbolCount; i += 1) pool.push(symbols[i % symbols.length]);
  return pickFrom(pool, roll);
}

function charForDensity(density, row, col, settings) {
  const seed = state.seed + Math.round(settings.alphabetAmount * 1000) + Math.round(settings.symbolDensity * 100);
  const roll = hash2d(col, row, seed);
  const accentRoll = hash2d(col + 911, row + 353, seed);
  const decorativeFrequency = settings.decorativeFrequency ?? 0.012;

  if (density > 0.42 && accentRoll < decorativeFrequency * clamp(density * 1.25, 0.15, 1)) {
    return pickFrom(DECORATIVE, hash2d(col + 71, row + 191, seed));
  }

  const alphabetAmount = settings.alphabetAmount ?? 0.76;
  const symbolDensity = settings.symbolDensity ?? 0.34;
  if (density > 0.72) {
    return mixedBand(ASCII_BANDS.dense, ["M", "W", "B", "Q", "R", "N", "D", "G", "m", "w", "b", "q", ...LETTERS_UPPER], ["@", "%", "#", "8"], alphabetAmount * 0.82, symbolDensity, roll);
  }
  if (density > 0.38) {
    return mixedBand(ASCII_BANDS.mid, [...LETTERS_UPPER, ...LETTERS_LOWER, ...LETTERS_LOWER], ["#", "+", "=", "*"], alphabetAmount, symbolDensity * 0.82, roll);
  }
  return mixedBand(ASCII_BANDS.light, [...LETTERS_LOWER, ...LETTERS_LOWER, "i", "l", "r", "t", "f", "j"], ["+", "=", "*", ":", ";", "~", "-", "."], alphabetAmount * 0.86, symbolDensity, roll);
}

function generateAsciiRows(settings) {
  if (!state.analysis) return [];

  const { width, height } = state.analysis;
  const columns = Math.round(settings.columns || 180);
  const fontSize = settings.fontSize || 7.5;
  const lineHeight = settings.lineHeight || 0.86;
  const letterSpacing = settings.letterSpacing || 0;
  const charWidth = Math.max(fontSize * 0.58 + letterSpacing, fontSize * 0.36);
  const rowHeight = Math.max(fontSize * lineHeight, fontSize * 0.62);
  const rows = Math.max(24, Math.round(columns * (height / width) * (charWidth / rowHeight)));
  const threshold = settings.threshold ?? 0.18;
  const result = [];

  for (let row = 0; row < rows; row += 1) {
    let text = "";
    const colors = [];
    for (let col = 0; col < columns; col += 1) {
      const sx = (col + 0.5) / columns * width;
      const sy = (row + 0.5) / rows * height;
      const luma = adjustedLuma(sampleLuma(sx, sy), settings);
      const density = clamp(1 - luma);
      if (density < threshold) {
        text += " ";
        colors.push(0);
        continue;
      }
      const normalized = clamp((density - threshold) / Math.max(1 - threshold, 0.01));
      text += charForDensity(normalized, row, col, settings);
      colors.push(normalized);
    }
    result.push({ text: text.replace(/\s+$/g, ""), colors });
  }

  return result;
}

function backgroundFill(settings) {
  if (settings.backgroundColor === "paper") return "#f7f7f2";
  if (settings.backgroundColor === "transparent") return "transparent";
  return "#010202";
}

function foregroundColor(settings, density, rowIndex) {
  if (settings.backgroundColor === "paper") return "#111313";
  if (settings.foregroundMode === "mint") return "#dfffee";
  if (settings.foregroundMode === "palette") {
    const palette = PALETTES[settings.palette] || PALETTES.veil;
    return palette[(rowIndex + Math.round(density * 5)) % palette.length];
  }
  return "#f1f4ed";
}

function asciiCharacterColor(settings, density, rowIndex, colIndex) {
  const base = foregroundColor(settings, density, rowIndex);
  if (settings.randomizeTextColor !== "on" || settings.backgroundColor === "paper") return base;

  const randomness = clamp((settings.colorRandomness ?? 28) / 100);
  if (randomness <= 0) return base;

  const palette = PALETTES.veil;
  const seed = state.seed + Math.round(randomness * 1000) + Math.round(density * 997);
  const roll = hash2d(colIndex + 1729, rowIndex + 811, seed);
  const colorRoll = hash2d(colIndex + 431, rowIndex + 1297, seed);
  if (roll > randomness) return base;

  return palette[Math.min(palette.length - 1, Math.floor(colorRoll * palette.length))];
}

function createRowGroup(doc, row, settings, rowIndex, metrics) {
  const group = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "ascii-row");
  group.setAttribute("id", `ascii-row-${rowIndex + 1}`);

  for (let col = 0; col < row.text.length; col += 1) {
    const char = row.text[col];
    if (char === " ") continue;
    const node = doc.createElementNS("http://www.w3.org/2000/svg", "text");
    node.setAttribute("class", "ascii-char");
    node.setAttribute("x", (col * metrics.charWidth).toFixed(2));
    node.setAttribute("y", (rowIndex * metrics.rowHeight).toFixed(2));
    node.setAttribute("fill", asciiCharacterColor(settings, row.colors[col] || 0, rowIndex, col));
    node.textContent = char;
    group.appendChild(node);
  }

  return group;
}

function createSvg(settings, rows) {
  const doc = document.implementation.createHTMLDocument("");
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.setAttribute("width", VIEW_W);
  svg.setAttribute("height", VIEW_H);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Dense editable ASCII portrait rendering");
  svg.setAttribute("data-editable", "true");

  const defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
  const glowIntensity = settings.glowIntensity ?? 0.18;
  defs.innerHTML = `
    <filter id="soft-bloom" x="-6%" y="-6%" width="112%" height="112%">
      <feGaussianBlur stdDeviation="${(glowIntensity * 1.25).toFixed(2)}" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${(glowIntensity * 0.24).toFixed(2)} 0" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="rgb-drift" x="-2%" y="-2%" width="104%" height="104%">
      <feOffset in="SourceGraphic" dx="-0.65" dy="0" result="r"/>
      <feOffset in="SourceGraphic" dx="0.65" dy="0" result="b"/>
      <feColorMatrix in="r" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .06 0" result="red"/>
      <feColorMatrix in="b" type="matrix" values="0 0 0 0 0 0 0.75 0 0 0 0 0 1 0 0 0 0 0 .05 0" result="blue"/>
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
  bg.setAttribute("fill", backgroundFill(settings));
  svg.appendChild(bg);

  const fontSize = settings.fontSize || 7.5;
  const charWidth = Math.max(fontSize * 0.58 + (settings.letterSpacing || 0), fontSize * 0.36);
  const rowHeight = Math.max(fontSize * (settings.lineHeight || 0.86), fontSize * 0.62);
  const textWidth = (settings.columns || 180) * charWidth;
  const textHeight = Math.max(1, rows.length - 1) * rowHeight + fontSize;
  const scale = Math.min((VIEW_W * 0.9) / textWidth, (VIEW_H * 0.86) / textHeight);
  const tx = (VIEW_W - textWidth * scale) / 2;
  const ty = (VIEW_H - textHeight * scale) / 2 + fontSize * scale;
  const metrics = { charWidth, rowHeight };

  const field = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  field.setAttribute("id", "editable-ascii-rows");
  field.setAttribute("filter", glowIntensity > 0 ? "url(#soft-bloom)" : "url(#rgb-drift)");
  field.setAttribute("font-family", "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
  field.setAttribute("font-size", fontSize.toFixed(2));
  field.setAttribute("font-weight", "700");
  field.setAttribute("text-rendering", "geometricPrecision");
  field.setAttribute("transform", `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})`);
  rows.forEach((row, index) => field.appendChild(createRowGroup(doc, row, settings, index, metrics)));
  svg.appendChild(field);

  const scan = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  scan.setAttribute("id", "subtle-scanlines");
  scan.setAttribute("width", VIEW_W);
  scan.setAttribute("height", VIEW_H);
  scan.setAttribute("fill", "url(#scanline-pattern)");
  scan.setAttribute("opacity", "0.32");
  scan.setAttribute("mix-blend-mode", "screen");
  svg.appendChild(scan);

  return svg;
}

function render() {
  if (!state.image || !state.analysis) return;
  const settings = getSettings();
  state.rows = generateAsciiRows(settings);
  state.svg = createSvg(settings, state.rows);
  els.artworkCamera.replaceChildren(state.svg);
  applyPreviewView();
  els.mount.classList.add("has-artwork");
  els.dropzone.classList.add("has-output");
  els.emptyState.style.display = "none";
  [els.exportSvg, els.exportPng, els.exportPngHi].forEach((button) => (button.disabled = false));
  logPipeline("SVG generated", { rows: state.rows.length, columns: settings.columns });
}

function serializeSvg(includeBackground = true) {
  const clone = state.svg.cloneNode(true);
  if (!includeBackground) clone.querySelector("#black-background")?.remove();
  clone.setAttribute("width", VIEW_W);
  clone.setAttribute("height", VIEW_H);
  clone.removeAttribute("style");
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
  logPipeline("SVG generated", { export: true, bytes: blob.size });
  downloadBlob(blob, `${state.imageName}-classic-ascii.svg`);
}

function exportPng(scale = 2) {
  const svgMarkup = serializeSvg(true);
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
      if (blob) {
        logPipeline("PNG generated", { scale, width: canvas.width, height: canvas.height });
        downloadBlob(blob, `${state.imageName}-classic-ascii-${scale > 2 ? "4k" : "png"}.png`);
      }
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
    renderTimer = setTimeout(() => {
      if (state.image && state.analysis) render();
    }, 90);
  });
});

els.fileInput.addEventListener("change", (event) => loadImage(event.target.files[0]));
els.changeSource.addEventListener("click", () => {
  if (!els.fileInput.disabled) els.fileInput.click();
});
els.resetView.addEventListener("click", resetPreviewView);
els.artworkViewport.addEventListener("wheel", zoomPreview, { passive: false });
els.artworkViewport.addEventListener("pointerdown", startPreviewPan);
els.artworkViewport.addEventListener("pointermove", movePreviewPan);
els.artworkViewport.addEventListener("pointerup", endPreviewPan);
els.artworkViewport.addEventListener("pointercancel", endPreviewPan);
els.artworkViewport.addEventListener("dblclick", (event) => {
  if (!state.svg) return;
  event.preventDefault();
  resetPreviewView();
});
els.portfolioLink.addEventListener("click", () => {
  window.location.href = "https://davonsy.vercel.app/";
});
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
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  loadImage(file);
});

initMatrixRain();
initCursorParticles();
initLoadingScreen();
resetControlsToDefaults();
getSettings();
window.setTimeout(() => {
  resetControlsToDefaults();
  getSettings();
  if (state.image && state.analysis) render();
}, 120);

async function loadDemoImage() {
  const c = document.createElement("canvas");
  c.width = 720;
  c.height = 960;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f5f5f0";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#dadad2";
  ctx.beginPath();
  ctx.ellipse(374, 898, 190, 34, 0, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.lineWidth = 42;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(303, 488);
  ctx.bezierCurveTo(194, 548, 170, 665, 118, 770);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(428, 495);
  ctx.bezierCurveTo(558, 565, 596, 638, 644, 744);
  ctx.stroke();
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  loadImage(new File([blob], "sample-silhouette.png", { type: "image/png" }));
}

if (new URLSearchParams(window.location.search).has("demo")) {
  loadDemoImage().catch((error) => {
    window.__errors.push(error.message);
  });
}
