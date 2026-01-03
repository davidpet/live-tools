// index.ts (ES module). Compile with tsc to ./dist/index.js and load via <script type="module" src="./dist/index.js"></script>

type RoundMode = "nearest" | "down" | "up";
type MatteMode = "alpha" | "luma";

interface Elements {
  rows: HTMLInputElement;
  cols: HTMLInputElement;
  seqW: HTMLInputElement;
  seqH: HTMLInputElement;

  guarantee: HTMLInputElement;

  // Matte export
  matteMode: HTMLSelectElement;
  gapPx: HTMLInputElement;
  gapRange: HTMLInputElement;
  outerBorder: HTMLInputElement;
  btnMatteLines: HTMLButtonElement;
  matteViz: HTMLCanvasElement;

  outSeq: HTMLElement;
  outGrid: HTMLElement;
  outSel: HTMLElement;
  outCell: HTMLElement;
  outBaseScale: HTMLElement;
  outMeaning: HTMLElement;

  tilePicker: HTMLElement;
  tileOutputs: HTMLElement;

  btnCopyTile: HTMLButtonElement;
  btnCopyAll: HTMLButtonElement;
  btnReset: HTMLButtonElement;

  toast: HTMLElement;
}

interface TileRectPx {
  L: number; T: number; R: number; B: number;
  w: number; h: number;
  cx: number; cy: number;
}

interface TileCropCentered {
  // crop values in percent
  cropL: number; cropR: number; cropT: number; cropB: number;
  // how far the remaining window’s center shifts from frame center (px)
  centerOffsetX: number;
  centerOffsetY: number;
}

interface TileOutputs {
  // Distort -> Transform
  baseScalePct: number;

  // Crop
  cropL: number;
  cropR: number;
  cropT: number;
  cropB: number;

  // Motion -> Position
  posX: number;
  posY: number;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function trimZeros(s: string): string {
  const t = s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  return t === "-0" ? "0" : t;
}

function pow10(dec: number): number {
  return Math.pow(10, dec);
}

function roundValue(n: number, dec: number, mode: RoundMode): number {
  const f = pow10(dec);
  const eps = 1e-10;

  if (mode === "nearest") return Math.round(n * f) / f;
  if (mode === "down") return Math.floor(n * f + eps) / f;
  return Math.ceil(n * f - eps) / f;
}

function formatCandidate(n: number, dec: number, mode: RoundMode, preferNoLeadingZero: boolean): string {
  const v = roundValue(n, dec, mode);
  let s = trimZeros(v.toFixed(dec));

  if (preferNoLeadingZero && Math.abs(v) < 1 && v !== 0) {
    s = s.replace(/^0\./, ".").replace(/^-0\./, "-.");
  }
  return s;
}

/**
 * Format to fit Premiere's common "7 character" numeric entry behavior.
 * ('.' counts, and we omit leading zero for values < 1 when it helps.)
 */
function fmtPr(n: number, opts?: { maxChars?: number; mode?: RoundMode; preferNoLeadingZero?: boolean }): string {
  const maxChars = opts?.maxChars ?? 7;
  const mode: RoundMode = opts?.mode ?? "nearest";
  const preferNoLeadingZero = opts?.preferNoLeadingZero ?? true;

  if (!Number.isFinite(n)) return "0";
  if (Object.is(n, -0)) n = 0;
  if (n === 0) return "0";

  const a = Math.abs(n);
  const neg = n < 0;

  const intStr = String(Math.trunc(n));
  if (intStr.length > maxChars) return intStr;

  let startDec = 6;

  if (a < 1) {
    const maxDecForFrac = maxChars - (neg ? 2 : 1);
    startDec = clamp(Math.min(6, maxDecForFrac), 0, 6);
  } else {
    const intDigits = String(Math.floor(a)).length;
    const signLen = neg ? 1 : 0;
    const maxDecForInt = maxChars - signLen - intDigits - 1; // -1 for '.'
    startDec = clamp(Math.min(6, maxDecForInt), 0, 6);
  }

  for (let dec = startDec; dec >= 0; dec--) {
    const s = formatCandidate(n, dec, mode, preferNoLeadingZero);
    if (s.length <= maxChars) return s;
  }

  const fallback = formatCandidate(n, 0, mode, false);
  return fallback.length <= maxChars ? fallback : String(Math.trunc(n));
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      return true;
    } finally {
      document.body.removeChild(ta);
    }
  }
}

function downloadPngFromCanvas(canvas: HTMLCanvasElement, filename: string): Promise<boolean> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      resolve(true);
    }, "image/png");
  });
}

class GridTileApp {
  private readonly els: Elements;
  private selectedIndex = 0;

  private readonly defaults = {
    rows: 2,
    cols: 3,
    seqW: 1920,
    seqH: 1080,
    guarantee: true,

    matteMode: "alpha" as MatteMode,
    gapPx: 8,
    outerBorder: false,
  };

  constructor() {
    this.els = this.getElements();
    this.resetDefaults();
    this.bindEvents();
    this.render();
  }

  private getElements(): Elements {
    return {
      rows: byId<HTMLInputElement>("rows"),
      cols: byId<HTMLInputElement>("cols"),
      seqW: byId<HTMLInputElement>("seqW"),
      seqH: byId<HTMLInputElement>("seqH"),

      guarantee: byId<HTMLInputElement>("guarantee"),

      matteMode: byId<HTMLSelectElement>("matteMode"),
      gapPx: byId<HTMLInputElement>("gapPx"),
      gapRange: byId<HTMLInputElement>("gapRange"),
      outerBorder: byId<HTMLInputElement>("outerBorder"),
      btnMatteLines: byId<HTMLButtonElement>("btnMatteLines"),
      matteViz: byId<HTMLCanvasElement>("matteViz"),

      outSeq: byId<HTMLElement>("outSeq"),
      outGrid: byId<HTMLElement>("outGrid"),
      outSel: byId<HTMLElement>("outSel"),
      outCell: byId<HTMLElement>("outCell"),
      outBaseScale: byId<HTMLElement>("outBaseScale"),
      outMeaning: byId<HTMLElement>("outMeaning"),

      tilePicker: byId<HTMLElement>("tilePicker"),
      tileOutputs: byId<HTMLElement>("tileOutputs"),

      btnCopyTile: byId<HTMLButtonElement>("btnCopyTile"),
      btnCopyAll: byId<HTMLButtonElement>("btnCopyAll"),
      btnReset: byId<HTMLButtonElement>("btnReset"),

      toast: byId<HTMLElement>("toast"),
    };
  }

  private toast(msg: string): void {
    this.els.toast.textContent = msg;
    this.els.toast.classList.add("show");
    window.clearTimeout((this.toast as any)._t);
    (this.toast as any)._t = window.setTimeout(() => this.els.toast.classList.remove("show"), 1200);
  }

  private resetDefaults(): void {
    const d = this.defaults;
    this.els.rows.value = String(d.rows);
    this.els.cols.value = String(d.cols);
    this.els.seqW.value = String(d.seqW);
    this.els.seqH.value = String(d.seqH);
    this.els.guarantee.checked = d.guarantee;

    this.els.matteMode.value = d.matteMode;
    this.setGapPx(d.gapPx);
    this.els.outerBorder.checked = d.outerBorder;

    this.selectedIndex = 0;
  }

  private bindEvents(): void {
    const rerender = () => this.render();

    [this.els.rows, this.els.cols, this.els.seqW, this.els.seqH, this.els.guarantee]
      .forEach(node => node.addEventListener("input", rerender));

    this.els.matteMode.addEventListener("change", () => this.renderMatteViz());
    this.els.outerBorder.addEventListener("change", () => this.renderMatteViz());

    this.els.gapPx.addEventListener("input", () => {
      const v = Math.max(0, Math.floor(Number(this.els.gapPx.value || 0)));
      this.setGapPx(v);
      this.renderMatteViz();
    });

    this.els.gapRange.addEventListener("input", () => {
      const v = Math.max(0, Math.floor(Number(this.els.gapRange.value || 0)));
      this.setGapPx(v);
      this.renderMatteViz();
    });

    this.els.btnReset.addEventListener("click", () => {
      this.resetDefaults();
      this.render();
    });

    this.els.btnCopyTile.addEventListener("click", async () => {
      const data = this.compute();
      const t = data.tileBlocks[this.selectedIndex];
      const ok = await copyToClipboard(t);
      this.toast(ok ? "Copied selected tile" : "Copy failed (browser blocked)");
    });

    this.els.btnCopyAll.addEventListener("click", async () => {
      const data = this.compute();
      const text = data.tileBlocks.join("\n\n---\n\n");
      const ok = await copyToClipboard(text);
      this.toast(ok ? "Copied all tiles" : "Copy failed (browser blocked)");
    });

    this.els.btnMatteLines.addEventListener("click", async () => {
      const s = this.getMatteSettings();
      const ok = await this.downloadGridLinesMatte(s);
      this.toast(ok ? "Downloaded Lines matte" : "Matte export failed");
    });
  }

  private setGapPx(v: number): void {
    const vv = Math.max(0, Math.floor(v));
    this.els.gapPx.value = String(vv);
    this.els.gapRange.value = String(vv);
  }

  private fmtN(n: number): string {
    return fmtPr(n, { maxChars: 7, mode: "nearest", preferNoLeadingZero: true });
  }

  private fmtCrop(n: number, guarantee: boolean): string {
    return fmtPr(n, { maxChars: 7, mode: guarantee ? "down" : "nearest", preferNoLeadingZero: true });
  }

  private fmtScale(n: number, guarantee: boolean): string {
    // Scale should err on the safe side if guaranteeing coverage.
    return fmtPr(n, { maxChars: 7, mode: guarantee ? "up" : "nearest", preferNoLeadingZero: true });
  }

  private splitSizes(total: number, parts: number): number[] {
    const base = Math.floor(total / parts);
    const rem = total - base * parts;
    const arr: number[] = [];
    for (let i = 0; i < parts; i++) arr.push(base + (i < rem ? 1 : 0));
    return arr;
  }

  private cumulativeStarts(sizes: number[]): number[] {
    const starts: number[] = [0];
    for (let i = 0; i < sizes.length; i++) starts.push(starts[i] + sizes[i]);
    return starts;
  }

  private tileRectPx(r: number, c: number, rowStarts: number[], colStarts: number[]): TileRectPx {
    const L = colStarts[c];
    const R = colStarts[c + 1];
    const T = rowStarts[r];
    const B = rowStarts[r + 1];
    const w = R - L;
    const h = B - T;
    const cx = (L + R) / 2;
    const cy = (T + B) / 2;
    return { L, T, R, B, w, h, cx, cy };
  }

  private centeredCropForSize(seqW: number, seqH: number, w: number, h: number): TileCropCentered {
    // Crop to a centered window of size w x h, split odd pixels across sides.
    const leftPx = Math.floor((seqW - w) / 2);
    const rightPx = (seqW - w) - leftPx;
    const topPx = Math.floor((seqH - h) / 2);
    const botPx = (seqH - h) - topPx;

    const cropL = 100 * (leftPx / seqW);
    const cropR = 100 * (rightPx / seqW);
    const cropT = 100 * (topPx / seqH);
    const cropB = 100 * (botPx / seqH);

    // If leftPx != rightPx, the remaining window is offset by 0.5 px.
    const centerOffsetX = (rightPx - leftPx) / 2;
    const centerOffsetY = (botPx - topPx) / 2;

    return { cropL, cropR, cropT, cropB, centerOffsetX, centerOffsetY };
  }

  private computeBaseScale(seqW: number, seqH: number, colWidths: number[], rowHeights: number[]): number {
    // Use the max cell dims so ONE scale works for all tiles and still covers every crop window.
    const maxW = Math.max(...colWidths);
    const maxH = Math.max(...rowHeights);
    return 100 * Math.max(maxW / seqW, maxH / seqH);
  }

  private buildTileBlock(
    r: number, c: number, rect: TileRectPx, out: TileOutputs,
    seqW: number, seqH: number, guarantee: boolean
  ): string {
    const label = `R${r + 1}C${c + 1}`;

    const scale = this.fmtScale(out.baseScalePct, guarantee);

    const posX = this.fmtN(out.posX);
    const posY = this.fmtN(out.posY);

    const cropL = this.fmtCrop(out.cropL, guarantee);
    const cropR = this.fmtCrop(out.cropR, guarantee);
    const cropT = this.fmtCrop(out.cropT, guarantee);
    const cropB = this.fmtCrop(out.cropB, guarantee);

    return [
      `${label} — apply to the tile clip`,
      `Sequence: ${seqW}×${seqH}`,
      `Cell px: w=${rect.w}, h=${rect.h}`,
      ``,
      `Distort → Transform`,
      `  Scale: ${scale}%`,
      ``,
      `Crop (Video Effects → Transform → Crop)`,
      `  Left:   ${cropL}%`,
      `  Right:  ${cropR}%`,
      `  Top:    ${cropT}%`,
      `  Bottom: ${cropB}%`,
      ``,
      `Motion → Position`,
      `  X: ${posX}`,
      `  Y: ${posY}`,
      ``,
      `Reframe later: adjust Distort → Transform Position/Scale; keep Crop + Motion Position fixed.`,
    ].join("\n");
  }

  private kvRow(title: string, hint: string, valueText: string, copyValue: string): HTMLDivElement {
    const row = el("div", "kv");

    const left = el("div", "kvLeft");
    left.appendChild(el("div", "kvTitle", title));
    left.appendChild(el("div", "kvHint", hint));

    const value = el("div", "kvValue", valueText);

    const btn = el("button", "btn small", "Copy") as HTMLButtonElement;
    btn.type = "button";
    btn.addEventListener("click", async () => {
      const ok = await copyToClipboard(copyValue);
      this.toast(ok ? "Copied" : "Copy failed (browser blocked)");
    });

    row.appendChild(left);
    row.appendChild(value);
    row.appendChild(btn);
    return row;
  }

  private renderTilePicker(M: number, N: number): void {
    this.els.tilePicker.innerHTML = "";
    this.els.tilePicker.style.gridTemplateColumns = `repeat(${N}, minmax(0, 1fr))`;

    const total = M * N;
    this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, total - 1));

    for (let i = 0; i < total; i++) {
      const r = Math.floor(i / N);
      const c = i % N;
      const b = el("button", "tileBtn", `R${r + 1}C${c + 1}`) as HTMLButtonElement;
      b.type = "button";
      if (i === this.selectedIndex) b.classList.add("selected");

      b.addEventListener("click", () => {
        this.selectedIndex = i;
        this.render();
      });

      this.els.tilePicker.appendChild(b);
    }
  }

  private renderTileOutputs(rect: TileRectPx, out: TileOutputs, guarantee: boolean): void {
    this.els.tileOutputs.innerHTML = "";

    const section = el("div", "section");
    const header = el("div", "sectionHeader");

    const titleWrap = el("div", "sectionTitle");
    titleWrap.appendChild(el("div", "sectionTitleTop", "Selected tile values"));
    titleWrap.appendChild(el("div", "sectionTitleSub",
      "Enter Transform Scale, Crop values, then Motion Position. Reframe later by adjusting Transform Position/Scale."
    ));

    header.appendChild(titleWrap);
    section.appendChild(header);

    const body = el("div", "sectionBody");

    const scale = this.fmtScale(out.baseScalePct, guarantee);
    body.appendChild(this.kvRow("Transform Scale (%)", "Distort → Transform → Scale", scale + "%", scale));

    const posX = this.fmtN(out.posX);
    const posY = this.fmtN(out.posY);
    body.appendChild(this.kvRow("Motion Position X", "Motion → Position (X)", posX, posX));
    body.appendChild(this.kvRow("Motion Position Y", "Motion → Position (Y)", posY, posY));

    const cropL = this.fmtCrop(out.cropL, guarantee);
    const cropR = this.fmtCrop(out.cropR, guarantee);
    const cropT = this.fmtCrop(out.cropT, guarantee);
    const cropB = this.fmtCrop(out.cropB, guarantee);

    body.appendChild(this.kvRow("Crop Left (%)", "Crop effect → Left", cropL + "%", cropL));
    body.appendChild(this.kvRow("Crop Right (%)", "Crop effect → Right", cropR + "%", cropR));
    body.appendChild(this.kvRow("Crop Top (%)", "Crop effect → Top", cropT + "%", cropT));
    body.appendChild(this.kvRow("Crop Bottom (%)", "Crop effect → Bottom", cropB + "%", cropB));

    body.appendChild(el("div", "mini",
      `Cell px: w=${rect.w}, h=${rect.h}.`
    ));

    section.appendChild(body);
    this.els.tileOutputs.appendChild(section);
  }

  private compute(): {
    M: number; N: number; seqW: number; seqH: number;
    colWidths: number[]; rowHeights: number[];
    rowStarts: number[]; colStarts: number[];
    baseScalePct: number;
    tileRects: TileRectPx[];
    tileOuts: TileOutputs[];
    tileBlocks: string[];
  } {
    const M = Math.max(1, Math.floor(Number(this.els.rows.value || 1)));
    const N = Math.max(1, Math.floor(Number(this.els.cols.value || 1)));
    const seqW = Math.max(1, Math.floor(Number(this.els.seqW.value || 1)));
    const seqH = Math.max(1, Math.floor(Number(this.els.seqH.value || 1)));

    this.els.rows.value = String(M);
    this.els.cols.value = String(N);
    this.els.seqW.value = String(seqW);
    this.els.seqH.value = String(seqH);

    // Keep slider max sensible relative to sequence
    const maxGap = clamp(Math.floor(Math.min(seqW, seqH) / 10), 20, 300);
    this.els.gapRange.max = String(maxGap);

    const rowHeights = this.splitSizes(seqH, M);
    const colWidths = this.splitSizes(seqW, N);
    const rowStarts = this.cumulativeStarts(rowHeights);
    const colStarts = this.cumulativeStarts(colWidths);

    const baseScalePct = this.computeBaseScale(seqW, seqH, colWidths, rowHeights);

    const tileRects: TileRectPx[] = [];
    const tileOuts: TileOutputs[] = [];
    const tileBlocks: string[] = [];

    const guarantee = this.els.guarantee.checked;

    for (let r = 0; r < M; r++) {
      for (let c = 0; c < N; c++) {
        const rect = this.tileRectPx(r, c, rowStarts, colStarts);

        // Crop window size matches this cell (w/h), centered in the frame.
        const crop = this.centeredCropForSize(seqW, seqH, rect.w, rect.h);

        // Motion position places the (possibly 0.5px-shifted) crop window center onto the cell center.
        const posX = rect.cx + crop.centerOffsetX;
        const posY = rect.cy + crop.centerOffsetY;

        const out: TileOutputs = {
          baseScalePct,
          cropL: crop.cropL,
          cropR: crop.cropR,
          cropT: crop.cropT,
          cropB: crop.cropB,
          posX,
          posY,
        };

        tileRects.push(rect);
        tileOuts.push(out);
        tileBlocks.push(this.buildTileBlock(r, c, rect, out, seqW, seqH, guarantee));
      }
    }

    return { M, N, seqW, seqH, colWidths, rowHeights, rowStarts, colStarts, baseScalePct, tileRects, tileOuts, tileBlocks };
  }

  private render(): void {
    const data = this.compute();
    const { M, N, seqW, seqH } = data;

    const total = M * N;
    this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, total - 1));

    this.els.outSeq.textContent = `${seqW}×${seqH}`;
    this.els.outGrid.textContent = `${M}×${N}`;

    const selR = Math.floor(this.selectedIndex / N);
    const selC = this.selectedIndex % N;
    this.els.outSel.textContent = `R${selR + 1}C${selC + 1}`;

    const rect = data.tileRects[this.selectedIndex];
    this.els.outCell.textContent = `${rect.w}×${rect.h}`;

    const guarantee = this.els.guarantee.checked;
    const baseScaleTxt = this.fmtScale(data.baseScalePct, guarantee);
    this.els.outBaseScale.textContent = `${baseScaleTxt}%`;
    this.els.outMeaning.textContent = `“Fill-to-cell” baseline (assumes 100% = fills the full sequence)`;

    this.renderTilePicker(M, N);
    this.renderTileOutputs(rect, data.tileOuts[this.selectedIndex], guarantee);

    const btns = Array.from(this.els.tilePicker.querySelectorAll(".tileBtn"));
    btns.forEach((b, i) => {
      if (i === this.selectedIndex) b.classList.add("selected");
      else b.classList.remove("selected");
    });

    this.renderMatteViz();
  }

  // -------------------------
  // Matte export (lines only)
  // -------------------------

  private getMatteSettings(): { rows: number; cols: number; W: number; H: number; gapPx: number; outerBorder: boolean; mode: MatteMode } {
    const data = this.compute();
    const gapPx = Math.max(0, Math.floor(Number(this.els.gapPx.value || 0)));
    this.setGapPx(gapPx);

    const outerBorder = this.els.outerBorder.checked;
    const mode = (this.els.matteMode.value === "luma" ? "luma" : "alpha") as MatteMode;
    return { rows: data.M, cols: data.N, W: data.seqW, H: data.seqH, gapPx, outerBorder, mode };
  }

  private generateLinesMatteCanvas(opts: { rows: number; cols: number; W: number; H: number; gapPx: number; outerBorder: boolean; mode: MatteMode }): HTMLCanvasElement {
    const rows = Math.max(1, Math.floor(opts.rows));
    const cols = Math.max(1, Math.floor(opts.cols));
    const W = Math.max(1, Math.floor(opts.W));
    const H = Math.max(1, Math.floor(opts.H));
    const gapPx = Math.max(0, Math.floor(opts.gapPx));
    const half = gapPx / 2;
    const outer = opts.outerBorder ? gapPx : 0; // FULL thickness outside

    const rowHeights = this.splitSizes(H, rows);
    const colWidths = this.splitSizes(W, cols);
    const rowStarts = this.cumulativeStarts(rowHeights);
    const colStarts = this.cumulativeStarts(colWidths);

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    ctx.imageSmoothingEnabled = false;

    if (opts.mode === "luma") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.clearRect(0, 0, W, H);
    }

    ctx.fillStyle = "#fff";

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const L = colStarts[c];
        const R = colStarts[c + 1];
        const T = rowStarts[r];
        const B = rowStarts[r + 1];

        // Internal edges split thickness; outer edges take FULL thickness.
        const insetL = c > 0 ? half : outer;
        const insetR = c < cols - 1 ? half : outer;
        const insetT = r > 0 ? half : outer;
        const insetB = r < rows - 1 ? half : outer;

        // Conservative integer bounds (never leak into the gap):
        const x0 = Math.ceil(L + insetL);
        const x1 = Math.floor(R - insetR);
        const y0 = Math.ceil(T + insetT);
        const y1 = Math.floor(B - insetB);

        const w = Math.max(0, x1 - x0);
        const h = Math.max(0, y1 - y0);

        if (w > 0 && h > 0) ctx.fillRect(x0, y0, w, h);
      }
    }

    return canvas;
  }

  private async downloadGridLinesMatte(opts: { rows: number; cols: number; W: number; H: number; gapPx: number; outerBorder: boolean; mode: MatteMode }): Promise<boolean> {
    const canvas = this.generateLinesMatteCanvas(opts);
    const borderTag = opts.outerBorder ? "outer" : "noOuter";
    const gapTag = `lines${opts.gapPx}px`;
    const filename = `grid_lines_matte_${opts.rows}x${opts.cols}_${opts.W}x${opts.H}_${gapTag}_${borderTag}_${opts.mode}.png`;
    return downloadPngFromCanvas(canvas, filename);
  }

  // -------------------------
  // Matte visualizer
  // -------------------------

  private resizeVizCanvasToAspect(seqW: number, seqH: number): void {
    const canvas = this.els.matteViz;

    // Keep a stable width but match aspect ratio.
    const targetW = 360;
    const targetH = Math.round(targetW * (seqH / seqW));
    const clampedH = clamp(targetH, 160, 260);

    canvas.width = targetW;
    canvas.height = clampedH;
  }

  private renderMatteViz(): void {
    const data = this.compute();
    const { M, N, seqW, seqH } = data;

    const gapPx = Math.max(0, Math.floor(Number(this.els.gapPx.value || 0)));
    const outerBorder = this.els.outerBorder.checked;

    this.resizeVizCanvasToAspect(seqW, seqH);

    const canvas = this.els.matteViz;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    // Colors for preview (not exported):
    const bg = "#ffffff";
    const tile = "rgba(0,0,0,0.12)";
    const line = "rgba(255,255,255,1)";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Convert real px thickness to preview px thickness proportionally.
    const sx = canvas.width / seqW;
    const sy = canvas.height / seqH;
    const t = Math.max(0, Math.round(gapPx * Math.min(sx, sy)));

    const outerT = outerBorder ? t : 0;
    const half = t / 2;

    // Build preview cell boundaries using the same splitSizes logic.
    const rowHeights = this.splitSizes(canvas.height, M);
    const colWidths = this.splitSizes(canvas.width, N);
    const rowStarts = this.cumulativeStarts(rowHeights);
    const colStarts = this.cumulativeStarts(colWidths);

    // Draw tiles (inset leaving “lines” as background)
    ctx.fillStyle = tile;
    for (let r = 0; r < M; r++) {
      for (let c = 0; c < N; c++) {
        const L = colStarts[c];
        const R = colStarts[c + 1];
        const T = rowStarts[r];
        const B = rowStarts[r + 1];

        const insetL = c > 0 ? half : outerT;
        const insetR = c < N - 1 ? half : outerT;
        const insetT = r > 0 ? half : outerT;
        const insetB = r < M - 1 ? half : outerT;

        const x0 = Math.ceil(L + insetL);
        const x1 = Math.floor(R - insetR);
        const y0 = Math.ceil(T + insetT);
        const y1 = Math.floor(B - insetB);

        const w = Math.max(0, x1 - x0);
        const h = Math.max(0, y1 - y0);

        if (w > 0 && h > 0) ctx.fillRect(x0, y0, w, h);
      }
    }

    // Optional: draw a subtle outline around the whole preview
    // ctx.strokeStyle = line;
    // ctx.lineWidth = 1;
    // ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new GridTileApp();
});

export {};
