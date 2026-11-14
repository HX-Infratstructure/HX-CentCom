import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Not `new URL("../styles.css", import.meta.url)`: Vite rewrites that pattern into a served asset URL, which is not a
// file: URL.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");

type Oklch = { readonly l: number; readonly c: number; readonly h: number };

function rootTokens(source: string): ReadonlyMap<string, Oklch> {
  const root = /:root\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
  const tokens = new Map<string, Oklch>();
  for (const m of root.matchAll(/--([\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g)) {
    const [, name = "", l = "", c = "", h = ""] = m;
    tokens.set(name, { l: Number(l), c: Number(c), h: Number(h) });
  }
  return tokens;
}

/** OKLCH to linear sRGB (Björn Ottosson's OKLab matrices), clamped to the displayable range. */
function linearRgb({ l, c, h }: Oklch): readonly [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    clamp(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    clamp(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ];
}

function luminance(color: Oklch): number {
  const [r, g, b] = linearRgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const tokens = rootTokens(css);

function token(name: string): Oklch {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`--${name} is not an oklch token in :root`);
  return value;
}

describe("design tokens in src/styles.css", () => {
  it("reproduces a known ratio, so the arithmetic is trusted", () => {
    expect(contrast({ l: 0.55, c: 0.014, h: 170 }, { l: 0.95, c: 0.003, h: 160 })).toBeCloseTo(
      4.17,
      2,
    );
  });

  it.each([
    ["muted-foreground", "card"],
    ["muted-foreground", "background"],
    ["muted-foreground", "secondary"],
    ["muted-foreground", "muted"],
    ["amber", "amber-soft"],
    ["amber", "card"],
    ["stone", "card"],
    ["stone", "secondary"],
    ["violet", "violet-soft"],
    ["sky", "sky-soft"],
    ["green", "green-soft"],
    ["primary", "card"],
    ["foreground", "primary-soft"],
    ["rail-text", "rail-active"],
    ["rail-muted", "rail"],
    ["primary-foreground", "primary"],
    ["destructive", "card"],
    ["foreground", "background"],
  ])("text --%s on --%s meets WCAG AA (4.5:1)", (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["input-border", "card"],
    ["input-border", "background"],
    ["rail-text", "rail"],
    ["primary", "background"],
  ])("control edge or focus ring --%s on --%s meets 3:1", (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });

  it("gives every [data-tone] rule a foreground that reads on its background at 4.5:1", () => {
    const rules = [...css.matchAll(/\[data-tone="([a-z]+)"\]\s*\{([^}]*)\}/g)];
    expect(rules.map((r) => r[1])).toEqual(["green", "sky", "amber", "violet", "stone"]);
    for (const [, tone, body = ""] of rules) {
      const fg = /--tone-fg:\s*var\(--([\w-]+)\)/.exec(body)?.[1];
      const bg = /--tone-bg:\s*var\(--([\w-]+)\)/.exec(body)?.[1];
      expect(fg, `${tone} sets --tone-fg`).toBeDefined();
      expect(bg, `${tone} sets --tone-bg`).toBeDefined();
      expect(contrast(token(fg ?? ""), token(bg ?? "")), `${tone}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives every [data-hue] rule an ink that white text reads on, and that reads on white, at 4.5:1", () => {
    const rules = [...css.matchAll(/\[data-hue="([a-z]+)"\]\s*\{([^}]*)\}/g)];
    expect(rules.map((r) => r[1])).toEqual(["green", "orange", "red", "purple", "blue", "grey"]);
    for (const [, hue, body = ""] of rules) {
      const ink = /--hue-ink:\s*var\(--([\w-]+)\)/.exec(body)?.[1];
      expect(ink, `${hue} sets --hue-ink`).toBeDefined();
      expect(
        contrast(token("primary-foreground"), token(ink ?? "")),
        `${hue}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(ink ?? ""), token("card")), `${hue} on card`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
