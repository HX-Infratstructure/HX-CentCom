import type { Page } from "playwright";

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

const WHITE: Rgba = [255, 255, 255, 1];
const SAMPLE_LIMIT = 400;

export interface ContrastPair {
  readonly selector: string;
  readonly text: string;
  readonly fg: Rgb;
  readonly bg: Rgb;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly ratio: number;
  readonly required: number;
  readonly pass: boolean;
}

export interface ContrastSample {
  readonly pairs: readonly ContrastPair[];
  readonly skipped: number;
  readonly sampled: number;
  readonly limit: number;
}

interface RawSample {
  readonly selector: string;
  readonly text: string;
  readonly fg: Rgba;
  readonly layers: readonly Rgba[];
  readonly opacity: number;
  readonly fontSize: number;
  readonly fontWeight: number;
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function isLargeText(px: number, weight: number): boolean {
  return px >= 24 || (px >= 18.66 && weight >= 700);
}

export function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3] + bottom[3] * (1 - top[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha;
  return [mix(0), mix(1), mix(2), alpha];
}

function toPair(sample: RawSample): ContrastPair {
  const bg = [...sample.layers]
    .reverse()
    .reduce<Rgba>((under, layer) => composite(layer, under), WHITE);
  const fgLayer: Rgba = [sample.fg[0], sample.fg[1], sample.fg[2], sample.fg[3] * sample.opacity];
  const fg = composite(fgLayer, bg);
  const ratio = Math.round(contrastRatio([fg[0], fg[1], fg[2]], [bg[0], bg[1], bg[2]]) * 100) / 100;
  const required = isLargeText(sample.fontSize, sample.fontWeight) ? 3 : 4.5;
  const { selector, text, fontSize, fontWeight } = sample;
  return {
    selector,
    text,
    fontSize,
    fontWeight,
    ratio,
    required,
    pass: ratio >= required,
    fg: [fg[0], fg[1], fg[2]],
    bg: [bg[0], bg[1], bg[2]],
  };
}

export async function sampleContrast(page: Page): Promise<ContrastSample> {
  const { samples, sampled } = await page.evaluate(collectTextSamples, SAMPLE_LIMIT);
  return {
    pairs: samples.map(toPair),
    skipped: sampled - samples.length,
    sampled,
    limit: SAMPLE_LIMIT,
  };
}

function collectTextSamples(limit: number): { samples: RawSample[]; sampled: number } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d canvas context");
  const toRgba = (color: string): Rgba => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
  };
  const ownText = (el: Element) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  const visible = (el: Element) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const srOnly = cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)";
    return (
      box.width >= 1 &&
      box.height >= 1 &&
      cs.visibility === "visible" &&
      cs.display !== "none" &&
      !srOnly
    );
  };
  const backdrop = (el: Element) => {
    const layers: Rgba[] = [];
    let opacity = 1;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      opacity *= parseFloat(cs.opacity);
      if (cs.backgroundImage !== "none") return null;
      const bg = toRgba(cs.backgroundColor);
      if (bg[3] > 0) layers.push(bg);
      if (bg[3] >= 1) break;
    }
    return { layers, opacity };
  };
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);
  const texts = [...document.body.querySelectorAll("*")].filter(
    (el) => !skipTags.has(el.tagName.toUpperCase()) && ownText(el) && visible(el),
  );
  const considered = texts.slice(0, limit);
  const samples = considered.flatMap((el) => {
    const back = backdrop(el);
    if (!back) return [];
    const cs = getComputedStyle(el);
    const selector = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "");
    const sample: RawSample = {
      selector,
      text: ownText(el).slice(0, 60),
      fg: toRgba(cs.color),
      ...back,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10),
    };
    return [sample];
  });
  return { samples, sampled: considered.length };
}
