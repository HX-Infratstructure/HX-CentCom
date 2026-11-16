import { sampleContrast, type ContrastPair, type ContrastSample } from "../contrast.ts";
import type { CheckContext, CheckOutcome, LiveCheck } from "../types.ts";
import { checked, noData, verdict, type Part } from "../verdict.ts";
import { PAGE_ROUTES, type PageName } from "./shared.ts";

const CONTRAST_PAGES: readonly PageName[] = ["tasks", "decisions", "home"];
const SCOPE =
  "R7 measures text nodes only; text drawn by ::before/::after content is not measured.";

// The largest two-decimal value not above the ratio. Flooring ratio * 100 alone can lose a step to
// binary error, since 4.35 * 100 is 434.99999999999994.
export function displayRatio(ratio: number): number {
  const hundredths = Math.floor(ratio * 100);
  const candidates = [hundredths + 1, hundredths, hundredths - 1].map((n) => n / 100);
  return candidates.find((value) => value <= ratio) ?? ratio;
}

function describePair(pair: ContrastPair) {
  const { text, ratio, required, fg, bg, fontSize, fontWeight, selector } = pair;
  return {
    text: text.slice(0, 60),
    ratio: displayRatio(ratio),
    required,
    fg,
    bg,
    fontSize,
    fontWeight,
    selector,
  };
}

function lowestRatio(pairs: readonly ContrastPair[]): ContrastPair | null {
  return pairs.reduce<ContrastPair | null>(
    (low, p) => (!low || p.ratio < low.ratio ? p : low),
    null,
  );
}

function contrastPart(
  route: string,
  { pairs, sampled }: ContrastSample,
  failing: readonly ContrastPair[],
): Part {
  const worst = lowestRatio(failing);
  if (worst) {
    const { selector, ratio, required } = describePair(worst);
    return checked(
      false,
      `${route}: ${selector} at ${ratio}:1, needs ${required}:1 (${failing.length} failing)`,
    );
  }
  if (pairs.length > 0) return checked(true, `${route}: every text pair meets WCAG AA`);
  if (sampled > 0)
    return checked(false, `${route}: none of ${sampled} text elements could be measured`);
  return noData(`${route}: no text element was found`);
}

// A route that does not answer 200 is not measured. Its record keeps a measured route's keys, empty.
const UNMEASURED: ContrastSample = { pairs: [], skipped: 0, sampled: 0, found: 0, limit: 0 };

async function contrastOn(ctx: CheckContext, name: PageName) {
  const route = PAGE_ROUTES[name];
  const status = await ctx.session.goto(route);
  const screenshot = await ctx.screenshot(`contrast-${name}`);
  const answered = status === 200;
  const sample = answered ? await sampleContrast(ctx.session.page) : UNMEASURED;
  const { pairs, skipped, sampled, found, limit } = sample;
  const lowest = lowestRatio(pairs);
  const failing = pairs.filter((pair) => !pair.pass);
  return {
    route,
    status,
    screenshot,
    part: answered
      ? contrastPart(route, sample, failing)
      : checked(false, `${route}: answered ${status}`),
    checked: pairs.length,
    found,
    sampled,
    skipped,
    limit,
    lowest: lowest && describePair(lowest),
    failingCount: failing.length,
    failing: failing.slice(0, 10).map(describePair),
  };
}

async function contrast(ctx: CheckContext): Promise<CheckOutcome> {
  const pages = [];
  for (const name of CONTRAST_PAGES) pages.push(await contrastOn(ctx, name));
  return verdict(
    pages.map((page) => page.part),
    { scope: SCOPE, pages },
  );
}

export const checks: readonly LiveCheck[] = [{ id: "contrast", requirement: "R7", run: contrast }];
