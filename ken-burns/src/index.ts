// index.ts (ES module). Compile with tsc to ./dist/index.js and load via <script type="module" src="./dist/index.js"></script>

type PanMode = "none" | "h" | "v" | "d";
type PanDir =
  | "L2R" | "R2L"
  | "U2D" | "D2U"
  | "DR"  | "UR"  | "DL" | "UL";
type ZoomMode = "none" | "in" | "out";
type RoundMode = "nearest" | "up";

interface StyleDef {
  key: "subtle" | "cinematic" | "energetic";
  name: string;
  panRate: number;   // % of frame per second
  zoomRate: number;  // % per second
  blurPhotoPx1080: number; // target blur distance in px/frame at 1920-wide baseline
  blurTextPx1080: number;  // % of frame width per frame
}

interface PanDirOption {
  value: PanDir;
  label: string;
}

interface StyleResult {
  styleKey: StyleDef["key"];
  styleName: string;

  p: number;
  z: number;

  DX: number;
  DY: number;

  x0: number; y0: number;
  x1: number; y1: number;

  S_fit: number;
  S_fill: number;

  S_min: number;
  S0: number;
  S1: number;

  theta: number;
  blurPx: number;

  maxScale: number;
}

interface AppState {
  imgW: number; imgH: number;
  seqW: number; seqH: number;
  fps: number;
  T: number;

  isText: boolean;
  roundUpScale: boolean;

  panMode: PanMode;
  panDir: PanDir;
  zoomMode: ZoomMode;

  S_fit: number;
  S_fill: number;

  results: StyleResult[];
}

interface Elements {
  imgW: HTMLInputElement;
  imgH: HTMLInputElement;
  seqW: HTMLInputElement;
  seqH: HTMLInputElement;
  fps: HTMLInputElement;
  durS: HTMLInputElement;
  durF: HTMLInputElement;

  isText: HTMLInputElement;
  roundUpScale: HTMLInputElement;

  panMode: HTMLSelectElement;
  panDir: HTMLSelectElement;
  zoomMode: HTMLSelectElement;

  outFit: HTMLElement;
  outFill: HTMLElement;
  outT: HTMLElement;
  outCenter: HTMLElement;

  outputs: HTMLElement;

  btnCopyAll: HTMLButtonElement;
  btnReset: HTMLButtonElement;

  toast: HTMLElement;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
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
  if (mode === "nearest") {
    return Math.round(n * f) / f;
  }
  // mode === "up": ceil toward +infinity (used for positive scale values)
  // subtract a tiny epsilon to avoid floating errors when n*f is already integer-ish
  const eps = 1e-10;
  return Math.ceil(n * f - eps) / f;
}

function formatCandidate(n: number, dec: number, mode: RoundMode, preferNoLeadingZero: boolean): string {
  const v = roundValue(n, dec, mode);
  let s = trimZeros(v.toFixed(dec));

  if (preferNoLeadingZero && Math.abs(v) < 1) {
    s = s.replace(/^0\./, ".").replace(/^-0\./, "-.");
  }
  return s;
}

/**
 * Format to fit Premiere's "7 character" limit (where '-' and '.' count).
 * Strategy: try higher decimals first and keep the first candidate that fits.
 */
function fmtPr(n: number, opts?: { maxChars?: number; mode?: RoundMode; preferNoLeadingZero?: boolean }): string {
  const maxChars = opts?.maxChars ?? 7;
  const mode: RoundMode = opts?.mode ?? "nearest";
  const preferNoLeadingZero = opts?.preferNoLeadingZero ?? true;

  if (!Number.isFinite(n)) return "0";
  if (Object.is(n, -0)) n = 0;
  if (n === 0) return "0";

  const neg = n < 0;
  const a = Math.abs(n);

  // If it's too huge to ever fit, return integer string (may still exceed, but that's unavoidable)
  const intStr = String(Math.trunc(n));
  if (intStr.length > maxChars) return intStr;

  // Choose a starting decimal count.
  // We'll just try from 6 down to 0 (but never exceed what can plausibly fit for |n|<1)
  let startDec = 6;

  if (a < 1) {
    // With preferNoLeadingZero: ".dddddd" is 7 chars; "-.ddddd" is 7 chars
    // So max decimals depends on sign.
    const maxDecForFrac = maxChars - (neg ? 2 : 1); // "-." or "."
    startDec = clamp(Math.min(6, maxDecForFrac), 0, 6);
  } else {
    // For >=1, integer digits will eat some width; clamp to what might fit.
    const intDigits = String(Math.floor(a)).length;
    const signLen = neg ? 1 : 0;
    // Need room for: sign + intDigits + (dot if dec>0) + dec
    const maxDecForInt = maxChars - signLen - intDigits - 1; // -1 for '.'
    startDec = clamp(Math.min(6, maxDecForInt), 0, 6);
  }

  for (let dec = startDec; dec >= 0; dec--) {
    const s = formatCandidate(n, dec, mode, preferNoLeadingZero);
    if (s.length <= maxChars) return s;

    // If rounding increases integer digits (e.g., 999.999 -> 1000), try fewer decimals
    // loop continues.
  }

  // Fallback: no decimals.
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

class KenBurnsApp {
  private readonly els: Elements;

  private readonly defaults = {
    imgW: 1920, imgH: 1080,
    seqW: 1920, seqH: 1080,
    fps: 30,
    durS: 8, durF: 0,
    isText: false,
    roundUpScale: true,
    panMode: "h" as PanMode,
    panDir: "L2R" as PanDir,
    zoomMode: "none" as ZoomMode,
  };

  private readonly styles: StyleDef[] = [
    { key: "subtle",    name: "Subtle",    panRate: 1.0, zoomRate: 0.75, blurPhotoPx1080: 0.22, blurTextPx1080: 0.10  },
    { key: "cinematic", name: "Cinematic", panRate: 2.5, zoomRate: 1.5,  blurPhotoPx1080: 0.80, blurTextPx1080: 0.27 },
    { key: "energetic", name: "Energetic", panRate: 5.0, zoomRate: 3.0,  blurPhotoPx1080: 2.13, blurTextPx1080: 0.53  },
  ];

  private readonly panDirs: Record<PanMode, PanDirOption[]> = {
    h: [
      { value: "L2R", label: "L → R" },
      { value: "R2L", label: "R → L" },
    ],
    v: [
      { value: "U2D", label: "U → D" },
      { value: "D2U", label: "D → U" },
    ],
    d: [
      { value: "DR", label: "↘ (down-right)" },
      { value: "UR", label: "↗ (up-right)" },
      { value: "DL", label: "↙ (down-left)" },
      { value: "UL", label: "↖ (up-left)" },
    ],
    none: [{ value: "L2R", label: "—" }],
  };

  constructor() {
    this.els = this.getElements();
    this.resetDefaults();
    this.updatePanDirOptions();
    this.bindEvents();
    this.render();
  }

  private getElements(): Elements {
    return {
      imgW: byId<HTMLInputElement>("imgW"),
      imgH: byId<HTMLInputElement>("imgH"),
      seqW: byId<HTMLInputElement>("seqW"),
      seqH: byId<HTMLInputElement>("seqH"),
      fps: byId<HTMLInputElement>("fps"),
      durS: byId<HTMLInputElement>("durS"),
      durF: byId<HTMLInputElement>("durF"),

      isText: byId<HTMLInputElement>("isText"),
      roundUpScale: byId<HTMLInputElement>("roundUpScale"),

      panMode: byId<HTMLSelectElement>("panMode"),
      panDir: byId<HTMLSelectElement>("panDir"),
      zoomMode: byId<HTMLSelectElement>("zoomMode"),

      outFit: byId<HTMLElement>("outFit"),
      outFill: byId<HTMLElement>("outFill"),
      outT: byId<HTMLElement>("outT"),
      outCenter: byId<HTMLElement>("outCenter"),

      outputs: byId<HTMLElement>("outputs"),

      btnCopyAll: byId<HTMLButtonElement>("btnCopyAll"),
      btnReset: byId<HTMLButtonElement>("btnReset"),

      toast: byId<HTMLElement>("toast"),
    };
  }

  private bindEvents(): void {
    const rerender = () => this.render();

    [
      this.els.imgW, this.els.imgH, this.els.seqW, this.els.seqH,
      this.els.fps, this.els.durS, this.els.durF,
      this.els.isText, this.els.roundUpScale,
      this.els.panMode, this.els.panDir,
      this.els.zoomMode,
    ].forEach(node => node.addEventListener("input", rerender));

    this.els.panMode.addEventListener("change", () => {
      this.updatePanDirOptions();
      this.render();
    });

    this.els.btnReset.addEventListener("click", () => {
      this.resetDefaults();
      this.updatePanDirOptions();
      this.render();
    });

    this.els.btnCopyAll.addEventListener("click", async () => {
      const state = this.compute();
      const blocks = state.results.map(r => this.formatStyleForCopy(state, r));
      const ok = await copyToClipboard(blocks.join("\n\n---\n\n"));
      this.toast(ok ? "Copied to clipboard" : "Copy failed (browser blocked)");
    });
  }

  private toast(msg: string): void {
    this.els.toast.textContent = msg;
    this.els.toast.classList.add("show");
    window.clearTimeout((this.toast as any)._t);
    (this.toast as any)._t = window.setTimeout(() => this.els.toast.classList.remove("show"), 1200);
  }

  private resetDefaults(): void {
    const d = this.defaults;
    this.els.imgW.value = String(d.imgW);
    this.els.imgH.value = String(d.imgH);
    this.els.seqW.value = String(d.seqW);
    this.els.seqH.value = String(d.seqH);
    this.els.fps.value = String(d.fps);
    this.els.durS.value = String(d.durS);
    this.els.durF.value = String(d.durF);
    this.els.isText.checked = d.isText;
    this.els.roundUpScale.checked = d.roundUpScale;
    this.els.panMode.value = d.panMode;
    this.els.panDir.value = d.panDir;
    this.els.zoomMode.value = d.zoomMode;
  }

  private updatePanDirOptions(): void {
    const mode = this.els.panMode.value as PanMode;
    const opts = this.panDirs[mode] ?? this.panDirs.none;
    const current = this.els.panDir.value as PanDir;

    this.els.panDir.innerHTML = "";
    for (const o of opts) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      this.els.panDir.appendChild(opt);
    }

    const stillValid = opts.some(o => o.value === current);
    this.els.panDir.value = stillValid ? current : opts[0].value;
  }

  private fmtGeneral(n: number): string {
    return fmtPr(n, { maxChars: 7, mode: "nearest", preferNoLeadingZero: true });
  }

  private fmtScale(n: number, roundUp: boolean): string {
    // Scale is always positive in our UI, but keep it general.
    return fmtPr(n, { maxChars: 7, mode: roundUp ? "up" : "nearest", preferNoLeadingZero: true });
  }

  private compute(): AppState {
    const imgW = Math.max(1, Number(this.els.imgW.value || 1));
    const imgH = Math.max(1, Number(this.els.imgH.value || 1));
    const seqW = Math.max(1, Number(this.els.seqW.value || 1));
    const seqH = Math.max(1, Number(this.els.seqH.value || 1));
    const fps  = Math.max(1, Number(this.els.fps.value || 30));

    const sec = Math.max(0, Number(this.els.durS.value || 0));
    const frmRaw = Math.max(0, Number(this.els.durF.value || 0));

    const isText = this.els.isText.checked;
    const roundUpScale = this.els.roundUpScale.checked;

    const panMode = this.els.panMode.value as PanMode;
    const panDir  = this.els.panDir.value as PanDir;
    const zoomMode = this.els.zoomMode.value as ZoomMode;

    const frames = clamp(frmRaw, 0, Math.max(0, Math.floor(fps - 1)));
    if (frames !== frmRaw) this.els.durF.value = String(frames);

    const T = sec + frames / fps;

    // Fit/Fill
    const rW = seqW / imgW;
    const rH = seqH / imgH;
    const S_fit  = 100 * Math.min(rW, rH);
    const S_fill = 100 * Math.max(rW, rH);
    const S_base = S_fill;

    const cx = seqW / 2;
    const cy = seqH / 2;

    // Display: scale uses scale formatter? (purely informational)
    this.els.outFit.textContent = this.fmtScale(S_fit, this.els.roundUpScale.checked) + "%";
    this.els.outFill.textContent = this.fmtScale(S_fill, this.els.roundUpScale.checked) + "%";
    this.els.outT.textContent = this.fmtGeneral(T);
    this.els.outCenter.textContent = `${this.fmtGeneral(cx)}, ${this.fmtGeneral(cy)}`;

    const results: StyleResult[] = [];

    for (const st of this.styles) {
      let p = st.panRate;
      let z = st.zoomRate;
      const blurPx1080 = isText ? st.blurTextPx1080 : st.blurPhotoPx1080;
      // scale blur distance with sequence width (1920 baseline)
      const blurPxPerFrame = blurPx1080 * (seqW / 1920);

      if (isText) {
        p = Math.min(p * 0.5, 2.0);
        z = Math.min(z * 0.5, 1.0);
      }

      // Pan travel
      let DX = 0, DY = 0;
      if (panMode === "h") DX = (p/100) * seqW * T;
      if (panMode === "v") DY = (p/100) * seqH * T;
      if (panMode === "d") { DX = (p/100) * seqW * T; DY = (p/100) * seqH * T; }

      const ox = DX / 2;
      const oy = DY / 2;

      let x0 = cx, x1 = cx, y0 = cy, y1 = cy;

      if (panMode === "h") {
        if (panDir === "L2R") { x0 = cx - ox; x1 = cx + ox; }
        else { x0 = cx + ox; x1 = cx - ox; }
      } else if (panMode === "v") {
        if (panDir === "U2D") { y0 = cy - oy; y1 = cy + oy; }
        else { y0 = cy + oy; y1 = cy - oy; }
      } else if (panMode === "d") {
        if (panDir === "DR")      { x0 = cx - ox; y0 = cy - oy; x1 = cx + ox; y1 = cy + oy; }
        else if (panDir === "UR") { x0 = cx - ox; y0 = cy + oy; x1 = cx + ox; y1 = cy - oy; }
        else if (panDir === "DL") { x0 = cx + ox; y0 = cy - oy; x1 = cx - ox; y1 = cy + oy; }
        else                      { x0 = cx + ox; y0 = cy + oy; x1 = cx - ox; y1 = cy - oy; }
      }

      // Minimum coverage scale for pan travel
      let S_needX = -Infinity;
      let S_needY = -Infinity;
      if (DX > 0) S_needX = 100 * (seqW + DX) / imgW;
      if (DY > 0) S_needY = 100 * (seqH + DY) / imgH;

      let S_min = Math.max(S_base, S_needX, S_needY);

      // Zoom multiplier over duration
      const M = Math.pow(1 + (z/100), T);

      let S0 = S_min;
      let S1 = S_min;
      if (zoomMode === "in") { S0 = S_min;     S1 = S_min * M; }
      if (zoomMode === "out"){ S0 = S_min * M; S1 = S_min;     }

      const maxScale = Math.max(S_min, S0, S1);
      const U = maxScale / 100;

      // Shutter angle
      let pEff = 0;
      if (panMode !== "none" && p > 0 && T > 0) pEff = p;
      else if (zoomMode !== "none" && z > 0 && T > 0) pEff = z;

      let theta = 0;
      if (pEff > 0) {
        const vpx = (pEff / 100) * seqW; // pixels/sec based on %/s and seq width
        if (vpx > 0) {
        theta = 360 * fps * (blurPxPerFrame / vpx);
        } else {
        theta = 0;
        }

        theta = clamp(theta, 0, 360);
        if (isText) theta = Math.min(theta, 90);

        // reduce blur when upscaling
        if (U > 1.0) {
          let m = 1.0;
          if (U <= 1.25) m = 0.75;
          else if (U <= 1.5) m = 0.5;
          else m = 0.25;

          theta *= m;
          if (U > 1.5) theta = Math.min(theta, isText ? 0 : 45);
          theta = clamp(theta, 0, 360);
        }

        const zoomOnly = (panMode === "none" && zoomMode !== "none");
        if (zoomOnly) theta *= 0.35;   // zoom gets less blur than pan
        theta = clamp(theta, 0, 360);
      }

      let blurPx = 0;
      if (pEff > 0 && theta > 0) {
        const vpx = (pEff/100) * seqW;
        blurPx = vpx * (theta/360) * (1/fps);
      }

      results.push({
        styleKey: st.key,
        styleName: st.name,
        p, z,
        DX, DY,
        x0, y0, x1, y1,
        S_fit, S_fill,
        S_min, S0, S1,
        theta,
        blurPx,
        maxScale,
      });
    }

    return {
      imgW, imgH, seqW, seqH, fps, T,
      isText, roundUpScale,
      panMode, panDir, zoomMode,
      S_fit, S_fill,
      results
    };
  }

  private formatStyleForCopy(state: AppState, r: StyleResult): string {
    const scaleMode = state.roundUpScale ? "up" : "nearest";
    const fmtS = (v: number) => this.fmtScale(v, state.roundUpScale);
    const fmtN = (v: number) => this.fmtGeneral(v);

    return [
      `${r.styleName} — Transform values (Pr 7-char formatting; scale rounding: ${scaleMode})`,
      `Sequence: ${state.seqW}×${state.seqH} @ ${state.fps}fps`,
      `Clip duration: ${fmtN(state.T)}s`,
      `Computed Fit: ${this.fmtScale(r.S_fit, state.roundUpScale)}% • Fill: ${this.fmtScale(r.S_fill, state.roundUpScale)}%`,
      ``,
      `Transform → Position (Pan)`,
      `  Start X: ${fmtN(r.x0)}`,
      `  Start Y: ${fmtN(r.y0)}`,
      `  End X:   ${fmtN(r.x1)}`,
      `  End Y:   ${fmtN(r.y1)}`,
      ``,
      `Transform → Scale`,
      `  Pan Scale (min): ${fmtS(r.S_min)}%`,
      `  Zoom Start:      ${fmtS(r.S0)}%`,
      `  Zoom End:        ${fmtS(r.S1)}%`,
      ``,
      `Transform → Shutter Angle: ${fmtN(r.theta)}°`,
      `Notes: Upscaling max=${fmtS(r.maxScale)}% (red if >100%).`,
    ].join("\n");
  }

  private async copyValue(value: string): Promise<void> {
    const ok = await copyToClipboard(value);
    this.toast(ok ? "Copied" : "Copy failed (browser blocked)");
  }

  private kvRow(
    title: string,
    hint: string,
    valueText: string,
    copyValue: string,
    warn: boolean,
    enabled: boolean
  ): HTMLDivElement {
    const row = el("div", "kv");
    if (warn) row.classList.add("scaleWarn");

    const left = el("div", "kvLeft");
    left.appendChild(el("div", "kvTitle", title));
    left.appendChild(el("div", "kvHint", hint));

    const value = el("div", "kvValue", valueText);

    const btn = el("button", "btn small", "Copy") as HTMLButtonElement;
    btn.type = "button";
    btn.disabled = !enabled;
    btn.addEventListener("click", () => { void this.copyValue(copyValue); });

    row.appendChild(left);
    row.appendChild(value);
    row.appendChild(btn);

    return row;
  }

  private section(
    titleTop: string,
    titleSub: string,
    badgeText: string,
    active: boolean
  ): { root: HTMLDivElement; body: HTMLDivElement } {
    const root = el("div", "section");
    if (!active) root.classList.add("section--inactive");

    const header = el("div", "sectionHeader");

    const title = el("div", "sectionTitle");
    title.appendChild(el("div", "sectionTitleTop", titleTop));
    title.appendChild(el("div", "sectionTitleSub", titleSub));

    const badge = el("div", "sectionBadge", badgeText);

    header.appendChild(title);
    header.appendChild(badge);

    const body = el("div", "sectionBody");

    root.appendChild(header);
    root.appendChild(body);

    return { root, body };
  }

  private render(): void {
    const state = this.compute();
    this.els.outputs.innerHTML = "";

    const panActive = state.panMode !== "none";
    const zoomActive = state.zoomMode !== "none";
    const motionActive = panActive || zoomActive;

    const fmtN = (v: number) => this.fmtGeneral(v);
    const fmtS = (v: number) => this.fmtScale(v, state.roundUpScale);

    for (const r of state.results) {
      const card = el("div", "styleCard");

      const shd = el("div", "shd");
      const headLeft = el("div", "styleHeadLeft");
      headLeft.appendChild(el("div", "styleName", r.styleName));
      headLeft.appendChild(el("div", "badge", `${fmtN(r.p)}%/s pan • ${fmtN(r.z)}%/s zoom`));
      shd.appendChild(headLeft);

      const sbd = el("div", "sbd");

      // Pan section
      const panSec = this.section(
        "Pan — Transform → Position",
        "Premiere requires X and Y to be entered separately.",
        panActive ? "Needed" : "Not needed",
        panActive
      );

      if (panActive) {
        panSec.body.appendChild(this.kvRow("Pan Start X", "Transform → Position (X) at clip start", fmtN(r.x0), fmtN(r.x0), false, true));
        panSec.body.appendChild(this.kvRow("Pan Start Y", "Transform → Position (Y) at clip start", fmtN(r.y0), fmtN(r.y0), false, true));
        panSec.body.appendChild(this.kvRow("Pan End X",   "Transform → Position (X) at clip end",   fmtN(r.x1), fmtN(r.x1), false, true));
        panSec.body.appendChild(this.kvRow("Pan End Y",   "Transform → Position (Y) at clip end",   fmtN(r.y1), fmtN(r.y1), false, true));
      } else {
        panSec.body.appendChild(el("div", "note", "Pan is disabled (Pan mode = None). You can ignore Transform → Position."));
      }
      sbd.appendChild(panSec.root);

      // Scale section
      const scaleSec = this.section(
        "Scale — Transform → Scale",
        zoomActive
          ? "Use Pan Scale (min) as your baseline; then set Zoom Start/End."
          : "For pan-only, set Pan Scale (min). (Zoom is disabled.)",
        (panActive || zoomActive) ? "Needed" : "Optional",
        (panActive || zoomActive)
      );

      if (panActive && !zoomActive) {
        scaleSec.body.appendChild(this.kvRow(
            "Pan Scale (min)",
            "Set Transform → Scale (static), or as your lowest zoom keyframe",
            fmtS(r.S_min) + "%",
            fmtS(r.S_min),
            r.S_min > 100,
            true
        ));
      } else {
        scaleSec.body.appendChild(el("div", "note",
          "Pan is off, so the minimum scale is just Fill. Use Zoom Start/End below."
      ));
    }

      if (zoomActive) {
        scaleSec.body.appendChild(this.kvRow("Zoom Scale Start", "Transform → Scale at clip start", fmtS(r.S0) + "%", fmtS(r.S0), r.S0 > 100, true));
        scaleSec.body.appendChild(this.kvRow("Zoom Scale End",   "Transform → Scale at clip end",   fmtS(r.S1) + "%", fmtS(r.S1), r.S1 > 100, true));
      } else {
        scaleSec.body.appendChild(el("div", "note", "Zoom is disabled (Zoom mode = None). No Zoom Start/End keyframes needed."));
      }
      sbd.appendChild(scaleSec.root);

      // Motion blur section
      const blurSec = this.section(
        "Motion Blur — Transform → Shutter Angle",
        "If you don’t want blur, set Shutter Angle to 0.",
        motionActive ? "Optional" : "Not needed",
        motionActive
      );

      if (motionActive) {
        blurSec.body.appendChild(this.kvRow("Shutter Angle", "Transform → Shutter Angle", fmtN(r.theta) + "°", fmtN(r.theta), false, true));

        const info = el("div", "note");
        info.appendChild(el("div", "", `Pan travel: ${fmtN(r.DX)}px × ${fmtN(r.DY)}px (total).`));
        info.appendChild(el("div", "", `Predicted blur ≈ ${trimZeros(r.blurPx.toFixed(4))} px/frame (approx).`));
        info.appendChild(el("div", "", r.maxScale > 100 ? `Upscaling: YES (max ${fmtS(r.maxScale)}%). Blur auto-reduced.` : `Upscaling: no (all ≤ 100%).`));
        blurSec.body.appendChild(info);
      } else {
        blurSec.body.appendChild(el("div", "note", "No motion (Pan = None and Zoom = None). You can ignore Shutter Angle."));
      }
      sbd.appendChild(blurSec.root);

      card.appendChild(shd);
      card.appendChild(sbd);
      this.els.outputs.appendChild(card);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new KenBurnsApp();
});

export {};
