import { sampleContrast, type ContrastPair } from "../contrast.ts";
import type { CheckContext, CheckOutcome, LiveCheck } from "../types.ts";
import { checked, noData, verdict } from "../verdict.ts";

const CONTRAST_ROUTES = ["/tasks", "/decisions", "/"] as const;

function describePair(pair: ContrastPair) {
  const { text, ratio, required, fg, bg, fontSize, fontWeight, selector } = pair;
  return {
    text: text.slice(0, 60),
    ratio: Number(ratio.toFixed(2)),
    required,
    fg,
    bg,
    fontSize,
    fontWeight,
    selector,
  };
}

async function contrastOn(ctx: CheckContext, route: string) {
  await ctx.session.goto(route);
  const { pairs, skipped, sampled, limit } = await sampleContrast(ctx.session.page);
  const lowest = pairs.reduce<ContrastPair | null>(
    (low, p) => (!low || p.ratio < low.ratio ? p : low),
    null,
  );
  const failing = pairs.filter((pair) => !pair.pass);
  return {
    route,
    part:
      pairs.length > 0
        ? checked(failing.length === 0, `${route}: a text pair is below WCAG AA contrast`)
        : noData(`${route}: no text pair was sampled`),
    checked: pairs.length,
    sampled,
    skipped,
    limit,
    lowest: lowest && describePair(lowest),
    failing: failing.slice(0, 10).map(describePair),
  };
}

async function contrast(ctx: CheckContext): Promise<CheckOutcome> {
  const pages = [];
  for (const route of CONTRAST_ROUTES) pages.push(await contrastOn(ctx, route));
  const screenshot = await ctx.screenshot("contrast");
  return verdict(
    pages.map((page) => page.part),
    { pages, screenshot },
  );
}

export const checks: readonly LiveCheck[] = [{ id: "contrast", requirement: "R7", run: contrast }];
