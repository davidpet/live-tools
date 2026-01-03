type Layout = "tall" | "wide";

const CANVAS_DIM_PROBE_MAX = 65536;

function detectCanvasMaxDimension(): number {
  // This is a best-effort detection based on whether the browser clamps canvas width/height.
  // It does not guarantee that very large canvases won't fail later due to memory pressure,
  // but it avoids hard-coding a pessimistic limit.
  const c = document.createElement("canvas");

  function maxFor(setDim: (v: number) => void, getDim: () => number): number {
    let lo = 1;
    let hi = CANVAS_DIM_PROBE_MAX;
    let best = 1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      setDim(mid);
      if (getDim() === mid) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  const maxW = maxFor(
    (v) => {
      c.width = v;
      c.height = 1;
    },
    () => c.width
  );

  const maxH = maxFor(
    (v) => {
      c.width = 1;
      c.height = v;
    },
    () => c.height
  );

  return Math.min(maxW, maxH);
}

// Cached detected limit for this session
const CANVAS_MAX_DIM = detectCanvasMaxDimension();


function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el;
}

function getNumberInput(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

function getTextInput(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

function getTextArea(id: string): HTMLTextAreaElement {
  return $(id) as HTMLTextAreaElement;
}

function getFileInput(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

function getCanvas(id: string): HTMLCanvasElement {
  return $(id) as HTMLCanvasElement;
}

function setHidden(el: HTMLElement, hidden: boolean) {
  el.hidden = hidden;
}

function clampByte(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  const r = Math.round(n);
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}

function toHex2(n: number): string {
  const s = clampByte(n, 0).toString(16).toUpperCase();
  return s.length === 1 ? `0${s}` : s;
}

function parseHex2(s: string): number | null {
  const t = s.trim();
  if (!/^[0-9a-fA-F]{2}$/.test(t)) return null;
  return parseInt(t, 16);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function formatInt(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function getSelectedLayout(): Layout {
  const selected = document.querySelector<HTMLInputElement>('input[name="step1Layout"]:checked');
  return (selected?.value as Layout) ?? "tall";
}

function computeDims(N: number, M: number, layout: Layout) {
  const tilesW = layout === "wide" ? N * N : N;
  const tilesH = layout === "wide" ? N : N * N;
  const width = tilesW * M;
  const height = tilesH * M;
  return { tilesW, tilesH, width, height };
}

function v(i: number, N: number): number {
  // map index 0..N-1 to 0..255 inclusive
  if (N <= 1) return 0;
  return Math.round((i * 255) / (N - 1));
}

function tileIndexToRGB(t: number, N: number): { r: number; g: number; b: number } {
  const r = t % N;
  const g = Math.floor(t / N) % N;
  const b = Math.floor(t / (N * N));
  return { r, g, b };
}

function tileCoords(t: number, N: number, layout: Layout): { xTile: number; yTile: number } {
  const { r, g, b } = tileIndexToRGB(t, N);
  if (layout === "wide") {
    return { xTile: r + g * N, yTile: b };
  }
  // tall
  return { xTile: r, yTile: g + b * N };
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to create PNG blob.");
  return blob;
}

function setDownloadLink(a: HTMLAnchorElement, blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.textContent = `Download ${filename}`;
  a.hidden = false;
}

function revokeOldObjectUrl(a: HTMLAnchorElement) {
  try {
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("blob:")) URL.revokeObjectURL(href);
  } catch {
    // ignore
  }
}

async function loadPngToImageData(file: File): Promise<{ data: ImageData; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create 2D context.");
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data: imageData, width: bitmap.width, height: bitmap.height };
}

function detectGeometry(width: number, height: number):
  | { N: number; M: number; layout: Layout }
  | { error: string } {
  // Try wide: W = N^2 * M, H = N * M => W/H = N
  if (height > 0 && width % height === 0) {
    const N = width / height;
    if (Number.isInteger(N) && N >= 2 && N <= 256) {
      if (height % N === 0) {
        const M = height / N;
        if (M >= 1 && Number.isInteger(M)) {
          const expectedW = N * N * M;
          const expectedH = N * M;
          if (expectedW === width && expectedH === height) {
            return { N, M, layout: "wide" };
          }
        }
      }
    }
  }

  // Try tall: H = N^2 * M, W = N * M => H/W = N
  if (width > 0 && height % width === 0) {
    const N = height / width;
    if (Number.isInteger(N) && N >= 2 && N <= 256) {
      if (width % N === 0) {
        const M = width / N;
        if (M >= 1 && Number.isInteger(M)) {
          const expectedW = N * M;
          const expectedH = N * N * M;
          if (expectedW === width && expectedH === height) {
            return { N, M, layout: "tall" };
          }
        }
      }
    }
  }

  return {
    error:
      "Could not infer N/M/layout from dimensions. The image may have been resized, cropped, padded, or otherwise changed.",
  };
}

function compilePixelFilter(userCode: string): (R: number, G: number, B: number, X: number, Y: number, W: number, H: number) => number {
  // Pass-through by default: R/G/B begin as input. If script doesn't assign, they remain.
  // Also supports early `return;` by running userCode inside an IIFE.
  //
  // Returns packed RGB: (R<<16) | (G<<8) | B
  const wrapped = `
    let _R = R, _G = G, _B = B;
    (function(){
      ${userCode}
    })();
    if (!Number.isFinite(R)) R = _R;
    if (!Number.isFinite(G)) G = _G;
    if (!Number.isFinite(B)) B = _B;
    R = Math.max(0, Math.min(255, Math.round(R)));
    G = Math.max(0, Math.min(255, Math.round(G)));
    B = Math.max(0, Math.min(255, Math.round(B)));
    return (R << 16) | (G << 8) | (B);
  `;
  // eslint-disable-next-line no-new-func
  const fn = new Function("R", "G", "B", "X", "Y", "W", "H", wrapped) as (
    R: number,
    G: number,
    B: number,
    X: number,
    Y: number,
    W: number,
    H: number
  ) => number;
  return fn;
}

async function renderStep1Preview(N: number, layout: Layout, canvas: HTMLCanvasElement) {
  const tilesW = layout === "wide" ? N * N : N;
  const tilesH = layout === "wide" ? N : N * N;

  // Scale is purely for visibility; no grid/borders are drawn.
  // Keep preview reasonably sized; let container scroll if needed.
  const maxDimTiles = Math.max(tilesW, tilesH);
  const scale = Math.max(1, Math.min(6, Math.floor(500 / maxDimTiles) || 1));

  const w = tilesW * scale;
  const h = tilesH * scale;

  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;

  // Draw per-tile blocks.
  const totalTiles = N * N * N;
  for (let t = 0; t < totalTiles; t++) {
    const { r, g, b } = tileIndexToRGB(t, N);
    const rr = v(r, N);
    const gg = v(g, N);
    const bb = v(b, N);

    const { xTile, yTile } = tileCoords(t, N, layout);
    ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
    ctx.fillRect(xTile * scale, yTile * scale, scale, scale);
  }
}

async function generateStep1Pattern(
  N: number,
  M: number,
  layout: Layout,
  statusEl: HTMLElement,
  onProgress: (p: number) => void,
  cancelRef: { cancelled: boolean }
): Promise<Blob> {
  const { tilesW, tilesH, width, height } = computeDims(N, M, layout);

  if (width > CANVAS_MAX_DIM || height > CANVAS_MAX_DIM) {
  const mMax = Math.floor(CANVAS_MAX_DIM / (N * N));
  throw new Error(
    `Requested image is ${formatInt(width)}×${formatInt(height)} px. ` +
      `Your browser appears to support up to ~${formatInt(CANVAS_MAX_DIM)} px per canvas dimension. ` +
      `For N=${N}, use M ≤ ${Math.max(1, mMax)} (because one dimension is always N²·M in Tall/Wide).`
  );
}


  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create 2D context.");

  ctx.imageSmoothingEnabled = false;

  const totalTiles = N * N * N;
  const yieldEvery = 5000;

  statusEl.textContent = "Generating pattern…";

  for (let t = 0; t < totalTiles; t++) {
    if (cancelRef.cancelled) throw new Error("Cancelled.");

    const { r, g, b } = tileIndexToRGB(t, N);
    const rr = v(r, N);
    const gg = v(g, N);
    const bb = v(b, N);

    const { xTile, yTile } = tileCoords(t, N, layout);

    ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
    ctx.fillRect(xTile * M, yTile * M, M, M);

    if (t % yieldEvery === 0) {
      onProgress(t / totalTiles);
      await nextFrame();
    }
  }

  onProgress(1);
  statusEl.textContent = "Encoding PNG…";
  await nextFrame();

  return await canvasToPngBlob(canvas);
}

async function applyStep2Filter(
  img: ImageData,
  width: number,
  height: number,
  filterFn: (R: number, G: number, B: number, X: number, Y: number, W: number, H: number) => number,
  onProgress: (p: number) => void,
  cancelRef: { cancelled: boolean }
): Promise<ImageData> {
  const data = img.data; // Uint8ClampedArray
  const totalPixels = width * height;

  // Process in chunks to keep UI responsive.
  const chunkPixels = 150_000; // tune as needed
  let processed = 0;

  for (let y = 0; y < height; y++) {
    if (cancelRef.cancelled) throw new Error("Cancelled.");

    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      const p = rowStart + x;
      const i = p * 4;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      let packed: number;
      try {
        packed = filterFn(r, g, b, x, y, width, height);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Filter error at (x=${x}, y=${y}): ${msg}`);
      }

      data[i] = (packed >> 16) & 255;
      data[i + 1] = (packed >> 8) & 255;
      data[i + 2] = packed & 255;
      // alpha unchanged

      processed++;
      if (processed % chunkPixels === 0) {
        onProgress(processed / totalPixels);
        await nextFrame();
        if (cancelRef.cancelled) throw new Error("Cancelled.");
      }
    }
  }

  onProgress(1);
  return img;
}

function makePngFromImageData(img: ImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create 2D context.");
  ctx.putImageData(img, 0, 0);
  return canvasToPngBlob(canvas);
}

function sampleTileColor(
  data: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  tileX: number,
  tileY: number,
  M: number
): { r: number; g: number; b: number } {
  // Inset sampling to reduce edge bleed.
  let margin = Math.max(1, Math.floor(M * 0.2));
  if (margin * 2 >= M) margin = Math.max(0, Math.floor(M / 4));

  const x0 = tileX * M + margin;
  const y0 = tileY * M + margin;
  const region = M - margin * 2;

  // Sample a small grid inside the region and average (fast & robust).
  const s = Math.max(1, Math.min(8, region)); // sample points per axis
  const step = region / s;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let yy = 0; yy < s; yy++) {
    const py = Math.min(imgH - 1, Math.max(0, Math.floor(y0 + (yy + 0.5) * step)));
    for (let xx = 0; xx < s; xx++) {
      const px = Math.min(imgW - 1, Math.max(0, Math.floor(x0 + (xx + 0.5) * step)));
      const idx = (py * imgW + px) * 4;
      sumR += data[idx];
      sumG += data[idx + 1];
      sumB += data[idx + 2];
      count++;
    }
  }

  return {
    r: sumR / count,
    g: sumG / count,
    b: sumB / count,
  };
}

async function generateCubeLut(
  img: ImageData,
  geom: { N: number; M: number; layout: Layout },
  onProgress: (p: number) => void,
  cancelRef: { cancelled: boolean }
): Promise<Blob> {
  const { N, M, layout } = geom;
  const imgW = img.width;
  const imgH = img.height;
  const data = img.data;

  const lines: string[] = [];
  const title = `TileLUT_N${N}_M${M}_${layout}`;
  lines.push(`# Generated by 3D LUT Tile Pattern Tool`);
  lines.push(`TITLE "${title}"`);
  lines.push(`LUT_3D_SIZE ${N}`);
  lines.push(`DOMAIN_MIN 0.0 0.0 0.0`);
  lines.push(`DOMAIN_MAX 1.0 1.0 1.0`);

  const total = N * N * N;
  let done = 0;
  const yieldEvery = 5000;

  // Standard .cube ordering: R fastest, then G, then B slowest.
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        if (cancelRef.cancelled) throw new Error("Cancelled.");

        // Convert (r,g,b) -> tile coords, consistent with Step 1.
        let xTile: number;
        let yTile: number;
        if (layout === "wide") {
          xTile = r + g * N;
          yTile = b;
        } else {
          xTile = r;
          yTile = g + b * N;
        }

        const c = sampleTileColor(data, imgW, imgH, xTile, yTile, M);

        const rr = clampByte(c.r, 0) / 255;
        const gg = clampByte(c.g, 0) / 255;
        const bb = clampByte(c.b, 0) / 255;

        // Reasonable precision for .cube
        lines.push(`${rr.toFixed(6)} ${gg.toFixed(6)} ${bb.toFixed(6)}`);

        done++;
        if (done % yieldEvery === 0) {
          onProgress(done / total);
          await nextFrame();
        }
      }
    }
  }

  onProgress(1);
  return new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
}

function setStatus(el: HTMLElement, msg: string, tone: "normal" | "warn" | "error" | "ok" = "normal") {
  el.textContent = msg;
  el.style.color =
    tone === "error"
      ? "rgba(255,110,110,0.95)"
      : tone === "warn"
        ? "rgba(255,205,110,0.95)"
        : tone === "ok"
          ? "rgba(120,255,138,0.95)"
          : "";
}

function updateSwatch(el: HTMLElement, r: number, g: number, b: number) {
  el.style.backgroundColor = `rgb(${clampByte(r, 0)},${clampByte(g, 0)},${clampByte(b, 0)})`;
}

function computeTileCount(N: number): number {
  return N * N * N;
}

function validateN(N: number): string | null {
  if (!Number.isFinite(N) || !Number.isInteger(N)) return "N must be an integer.";
  if (N < 2) return "N must be at least 2.";
  if (N > 65) return "N above 65 is uncommon and can create very large images. (This tool caps UI N to 65.)";
  return null;
}

function validateM(M: number): string | null {
  if (!Number.isFinite(M) || !Number.isInteger(M)) return "M must be an integer.";
  if (M < 1) return "M must be at least 1.";
  if (M > 512) return "M is very large and may exceed canvas limits.";
  return null;
}

document.addEventListener("DOMContentLoaded", () => {
  // Step 1 elements
  const step1N = getNumberInput("step1N");
  const step1M = getNumberInput("step1M");
  const step1DimsPill = $("step1DimsPill");
  const step1TilesPill = $("step1TilesPill");
  const step1WarnPill = $("step1WarnPill");
  const step1PreviewCanvas = getCanvas("step1PreviewCanvas");
  const step1GenerateBtn = $("step1GenerateBtn") as HTMLButtonElement;
  const step1DownloadLink = $("step1DownloadLink") as HTMLAnchorElement;
  const step1Status = $("step1Status");

  let step1CancelRef = { cancelled: false };

  async function refreshStep1UI() {
    const N = Number(step1N.value);
    const M = Number(step1M.value);
    const layout = getSelectedLayout();

    const errN = validateN(N);
    const errM = validateM(M);

    if (errN) setStatus(step1Status, errN, "warn");
    else if (errM) setStatus(step1Status, errM, "warn");
    else setStatus(step1Status, "", "normal");

    const { tilesW, tilesH, width, height } = computeDims(N, M, layout);
    step1DimsPill.textContent = `PNG: ${formatInt(width)}×${formatInt(height)} px`;
    step1TilesPill.textContent = `Tiles: ${formatInt(tilesW)}×${formatInt(tilesH)} (total ${formatInt(computeTileCount(N))})`;

    let warn = "";
    if (width > CANVAS_MAX_DIM || height > CANVAS_MAX_DIM) {
      const mMax = Math.floor(CANVAS_MAX_DIM / (N * N));
      warn = `May exceed your browser's canvas limit (~${formatInt(CANVAS_MAX_DIM)}px per dimension). ` +
            `For N=${N}, suggested M ≤ ${Math.max(1, mMax)} (since N²·M must fit).`;
    } else if (computeTileCount(N) * (M * M) > 12_000_000) {
      warn = `Large image (~${formatInt(computeTileCount(N) * M * M)} pixels). Generation/processing may be slow.`;
    }

    if (warn) {
      step1WarnPill.textContent = warn;
      step1WarnPill.hidden = false;
    } else {
      step1WarnPill.hidden = true;
    }

    await renderStep1Preview(N, layout, step1PreviewCanvas);
  }

  document.querySelectorAll<HTMLInputElement>('input[name="step1Layout"]').forEach((r) => {
    r.addEventListener("change", () => void refreshStep1UI());
  });
  step1N.addEventListener("input", () => void refreshStep1UI());
  step1M.addEventListener("input", () => void refreshStep1UI());

  step1GenerateBtn.addEventListener("click", async () => {
    revokeOldObjectUrl(step1DownloadLink);
    step1DownloadLink.hidden = true;

    const N = Number(step1N.value);
    const M = Number(step1M.value);
    const layout = getSelectedLayout();

    const errN = validateN(N);
    const errM = validateM(M);
    if (errN) return setStatus(step1Status, errN, "error");
    if (errM && M > 0) setStatus(step1Status, errM, "warn");

    step1CancelRef = { cancelled: false };
    step1GenerateBtn.disabled = true;

    try {
      const blob = await generateStep1Pattern(
        N,
        M,
        layout,
        step1Status,
        (p) => {
          setStatus(step1Status, `Generating… ${Math.round(p * 100)}%`);
        },
        step1CancelRef
      );

      const filename = `tile_lut_identity_N${N}_M${M}_${layout}.png`;
      setDownloadLink(step1DownloadLink, blob, filename);
      step1DownloadLink.click();
      setStatus(step1Status, "Done.", "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(step1Status, msg, "error");
    } finally {
      step1GenerateBtn.disabled = false;
    }
  });

  // Step 2 elements
  const step2File = getFileInput("step2File");
  const step2FileHint = $("step2FileHint");
  const step2Script = getTextArea("step2Script");
  const step2LoadScript = getFileInput("step2LoadScript");
  const step2LoadScriptBtn = $("step2LoadScriptBtn") as HTMLButtonElement;
  const step2SaveScriptBtn = $("step2SaveScriptBtn") as HTMLButtonElement;
  const step2RunBtn = $("step2RunBtn") as HTMLButtonElement;
  const step2CancelBtn = $("step2CancelBtn") as HTMLButtonElement;
  const step2Progress = $("step2Progress") as HTMLProgressElement;
  const step2ProgressLabel = $("step2ProgressLabel");
  const step2DownloadLink = $("step2DownloadLink") as HTMLAnchorElement;
  const step2Status = $("step2Status");

  const testR = getTextInput("testR");
  const testG = getTextInput("testG");
  const testB = getTextInput("testB");
  const testInSwatch = $("testInSwatch");
  const testOutSwatch = $("testOutSwatch");
  const testInHex = $("testInHex");
  const testOutHex = $("testOutHex");
  const testFilterBtn = $("testFilterBtn") as HTMLButtonElement;
  const step2TestStatus = $("step2TestStatus");

  let step2CancelRef = { cancelled: false };
  let step2Loaded: { file: File; imageData: ImageData; width: number; height: number } | null = null;

  function updateTestInputSwatch() {
    const r = parseHex2(testR.value);
    const g = parseHex2(testG.value);
    const b = parseHex2(testB.value);
    if (r == null || g == null || b == null) {
      setStatus(step2TestStatus, "Enter valid 2-digit hex for R/G/B (00–FF).", "warn");
      updateSwatch(testInSwatch, 0, 0, 0);
      testInHex.textContent = "—";
      return null;
    }
    updateSwatch(testInSwatch, r, g, b);
    const hex = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
    testInHex.textContent = hex;
    setStatus(step2TestStatus, "", "normal");
    return { r, g, b };
  }

  ["input", "change"].forEach((evt) => {
    testR.addEventListener(evt, () => void updateTestInputSwatch());
    testG.addEventListener(evt, () => void updateTestInputSwatch());
    testB.addEventListener(evt, () => void updateTestInputSwatch());
  });
  updateTestInputSwatch();

  testFilterBtn.addEventListener("click", () => {
    const rgb = updateTestInputSwatch();
    if (!rgb) return;

    let fn: ReturnType<typeof compilePixelFilter>;
    try {
      fn = compilePixelFilter(step2Script.value);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(step2TestStatus, `Script compile error: ${msg}`, "error");
      return;
    }

    try {
      const packed = fn(rgb.r, rgb.g, rgb.b, 0, 0, 1, 1);
      const outR = (packed >> 16) & 255;
      const outG = (packed >> 8) & 255;
      const outB = packed & 255;

      updateSwatch(testOutSwatch, outR, outG, outB);
      testOutHex.textContent = `#${toHex2(outR)}${toHex2(outG)}${toHex2(outB)}`;
      setStatus(step2TestStatus, "Test complete.", "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(step2TestStatus, `Runtime error: ${msg}`, "error");
    }
  });

  step2LoadScriptBtn.addEventListener("click", () => {
    step2LoadScript.value = "";
    step2LoadScript.click();
  });

  step2LoadScript.addEventListener("change", async () => {
    const f = step2LoadScript.files?.[0];
    if (!f) return;
    const text = await f.text();
    step2Script.value = text;
    setStatus(step2Status, `Loaded script: ${f.name}`, "ok");
  });

  step2SaveScriptBtn.addEventListener("click", () => {
    const blob = new Blob([step2Script.value], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pixel_filter.js";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(step2Status, "Saved script.", "ok");
  });

  step2File.addEventListener("change", async () => {
    revokeOldObjectUrl(step2DownloadLink);
    step2DownloadLink.hidden = true;

    const f = step2File.files?.[0];
    if (!f) return;

    try {
      setStatus(step2Status, "Loading image…");
      const loaded = await loadPngToImageData(f);
      step2Loaded = { file: f, imageData: loaded.data, width: loaded.width, height: loaded.height };
      step2FileHint.textContent = `Loaded: ${f.name} (${formatInt(loaded.width)}×${formatInt(loaded.height)} px)`;
      setStatus(step2Status, "Ready.", "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      step2Loaded = null;
      step2FileHint.textContent = "No file loaded.";
      setStatus(step2Status, msg, "error");
    }
  });

  step2CancelBtn.addEventListener("click", () => {
    step2CancelRef.cancelled = true;
    setStatus(step2Status, "Cancelling…", "warn");
  });

  step2RunBtn.addEventListener("click", async () => {
    revokeOldObjectUrl(step2DownloadLink);
    step2DownloadLink.hidden = true;

    if (!step2Loaded) {
      return setStatus(step2Status, "Load a PNG first.", "error");
    }

    let fn: ReturnType<typeof compilePixelFilter>;
    try {
      fn = compilePixelFilter(step2Script.value);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return setStatus(step2Status, `Script compile error: ${msg}`, "error");
    }

    step2CancelRef = { cancelled: false };
    step2RunBtn.disabled = true;
    step2CancelBtn.disabled = false;
    step2Progress.hidden = false;
    step2Progress.value = 0;
    step2ProgressLabel.textContent = "";

    try {
      const { width, height } = step2Loaded;
      // clone ImageData so multiple runs don't mutate the original loaded image
      const imgCopy = new ImageData(new Uint8ClampedArray(step2Loaded.imageData.data), width, height);

      const out = await applyStep2Filter(
        imgCopy,
        width,
        height,
        fn,
        (p) => {
          step2Progress.value = p;
          step2ProgressLabel.textContent = `${Math.round(p * 100)}%`;
          setStatus(step2Status, `Processing… ${Math.round(p * 100)}%`);
        },
        step2CancelRef
      );

      setStatus(step2Status, "Encoding PNG…");
      await nextFrame();
      const blob = await makePngFromImageData(out);

      const base = step2Loaded.file.name.replace(/\.png$/i, "");
      const filename = `${base}_filtered.png`;
      setDownloadLink(step2DownloadLink, blob, filename);
      step2DownloadLink.click();
      setStatus(step2Status, "Done.", "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(step2Status, msg, "error");
    } finally {
      step2RunBtn.disabled = false;
      step2CancelBtn.disabled = true;
      step2Progress.hidden = true;
      step2ProgressLabel.textContent = "";
    }
  });

  // Step 3 elements
  const step3File = getFileInput("step3File");
  const step3FileHint = $("step3FileHint");
  const step3DetectedN = $("step3DetectedN");
  const step3DetectedM = $("step3DetectedM");
  const step3DetectedLayout = $("step3DetectedLayout");
  const step3DetectHint = $("step3DetectHint");
  const step3GenerateBtn = $("step3GenerateBtn") as HTMLButtonElement;
  const step3CancelBtn = $("step3CancelBtn") as HTMLButtonElement;
  const step3Progress = $("step3Progress") as HTMLProgressElement;
  const step3ProgressLabel = $("step3ProgressLabel");
  const step3DownloadLink = $("step3DownloadLink") as HTMLAnchorElement;
  const step3Status = $("step3Status");

  let step3CancelRef = { cancelled: false };
  let step3Loaded: { file: File; imageData: ImageData; geom: { N: number; M: number; layout: Layout } } | null = null;

  step3CancelBtn.addEventListener("click", () => {
    step3CancelRef.cancelled = true;
    setStatus(step3Status, "Cancelling…", "warn");
  });

  step3File.addEventListener("change", async () => {
    revokeOldObjectUrl(step3DownloadLink);
    step3DownloadLink.hidden = true;
    step3GenerateBtn.disabled = true;
    step3Loaded = null;

    const f = step3File.files?.[0];
    if (!f) return;

    try {
      setStatus(step3Status, "Loading image…");
      const loaded = await loadPngToImageData(f);
      step3FileHint.textContent = `Loaded: ${f.name} (${formatInt(loaded.width)}×${formatInt(loaded.height)} px)`;

      const geom = detectGeometry(loaded.width, loaded.height);
      if ("error" in geom) {
        step3DetectedN.textContent = "N: —";
        step3DetectedM.textContent = "M: —";
        step3DetectedLayout.textContent = "Layout: —";
        step3DetectHint.textContent = geom.error;
        setStatus(step3Status, geom.error, "error");
        return;
      }

      step3DetectedN.textContent = `N: ${geom.N}`;
      step3DetectedM.textContent = `M: ${geom.M}`;
      step3DetectedLayout.textContent = `Layout: ${geom.layout}`;
      step3DetectHint.textContent = "Detected from image dimensions (no config needed).";

      step3Loaded = { file: f, imageData: loaded.data, geom };
      step3GenerateBtn.disabled = false;
      setStatus(step3Status, "Ready.", "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      step3FileHint.textContent = "No file loaded.";
      step3DetectHint.textContent = "Load a file to detect N/M/layout.";
      setStatus(step3Status, msg, "error");
    }
  });

  step3GenerateBtn.addEventListener("click", async () => {
    revokeOldObjectUrl(step3DownloadLink);
    step3DownloadLink.hidden = true;

    if (!step3Loaded) return setStatus(step3Status, "Load a processed PNG first.", "error");

    step3CancelRef = { cancelled: false };
    step3GenerateBtn.disabled = true;
    step3CancelBtn.disabled = false;
    step3Progress.hidden = false;
    step3Progress.value = 0;
    step3ProgressLabel.textContent = "";

    try {
      const cubeBlob = await generateCubeLut(
        step3Loaded.imageData,
        step3Loaded.geom,
        (p) => {
          step3Progress.value = p;
          step3ProgressLabel.textContent = `${Math.round(p * 100)}%`;
          setStatus(step3Status, `Generating LUT… ${Math.round(p * 100)}%`);
        },
        step3CancelRef
      );

      const base = step3Loaded.file.name.replace(/\.png$/i, "");
      const filename = `${base}_N${step3Loaded.geom.N}.cube`;
      setDownloadLink(step3DownloadLink, cubeBlob, filename);
      step3DownloadLink.click();
      setStatus(step3Status, "Done.", "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(step3Status, msg, "error");
    } finally {
      step3GenerateBtn.disabled = false;
      step3CancelBtn.disabled = true;
      step3Progress.hidden = true;
      step3ProgressLabel.textContent = "";
    }
  });

  // initial render
  void refreshStep1UI();
});
