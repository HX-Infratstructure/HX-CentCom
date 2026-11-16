import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { sampleContrast, type ContrastPair, type ContrastSample } from "../live-check/contrast.ts";
import { checks } from "../live-check/checks/contrast-check.ts";
import type { CheckContext } from "../live-check/types.ts";

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
});

async function sample(body: string): Promise<ContrastSample> {
  await page.setContent(`<body style="margin:0;background:#fff">${body}</body>`);
  return sampleContrast(page);
}

async function pairFor(body: string): Promise<ContrastPair> {
  const { pairs } = await sample(body);
  const pair = pairs.find((p) => p.selector === "span#t");
  assert.ok(pair, "the text was sampled");
  return pair;
}

describe("sampleContrast", () => {
  test("black text on white passes at 21", async () => {
    const pair = await pairFor(`<span id="t" style="color:#000">x</span>`);
    assert.equal(pair.ratio, 21);
    assert.equal(pair.pass, true);
  });

  test("group opacity fades the element's background with its text", async () => {
    const pair = await pairFor(
      `<div style="background:#000;opacity:.5"><span id="t" style="color:#fff">x</span></div>`,
    );
    assert.ok(pair.ratio < 4.5, `white on gray is below 4.5, got ${pair.ratio}`);
    assert.equal(pair.pass, false);
  });

  test("decides on the unrounded ratio", async () => {
    const pair = await pairFor(`<span id="t" style="color:rgb(118,119,118)">x</span>`);
    assert.ok(pair.ratio > 4.49 && pair.ratio < 4.5, `about 4.496, got ${pair.ratio}`);
    assert.equal(pair.pass, false);
  });

  test("ancestor opacity above an opaque background still applies", async () => {
    const pair = await pairFor(
      `<div style="opacity:.5"><span id="t" style="color:#000;background:#fff">x</span></div>`,
    );
    assert.ok(pair.ratio < 4.5, `gray on white is below 4.5, got ${pair.ratio}`);
    assert.equal(pair.pass, false);
  });

  test("a background image under an opaque background is ignored", async () => {
    const pair = await pairFor(
      `<div style="background-image:linear-gradient(#000,#000)"><span id="t" style="color:#000;background:#fff">x</span></div>`,
    );
    assert.equal(pair.ratio, 21);
  });

  test("text at opacity 0 is skipped, not failed", async () => {
    const result = await sample(
      `<div style="opacity:0"><span id="t" style="color:#fff">x</span></div>`,
    );
    assert.deepEqual([result.pairs.length, result.skipped], [0, 1]);
  });

  test("a background image behind the text skips the sample", async () => {
    const result = await sample(
      `<div style="background-image:linear-gradient(#000,#000)"><span id="t" style="color:#fff">x</span></div>`,
    );
    assert.deepEqual([result.pairs.length, result.skipped], [0, 1]);
  });
});

describe("contrast check evidence", () => {
  test("a failing pair's displayed ratio is rounded down", async () => {
    await page.setContent(
      `<body style="margin:0;background:#fff"><span style="color:rgb(118,119,118)">x</span></body>`,
    );
    const ctx = {
      session: { page, goto: async () => 200 },
      screenshot: async () => "contrast.png",
    } as unknown as CheckContext;
    const [check] = checks;
    assert.ok(check);
    const outcome = await check.run(ctx);
    const pages = outcome.evidence["pages"] as { failing: { ratio: number; required: number }[] }[];
    assert.equal(outcome.status, "FAIL");
    assert.deepEqual(pages[0]?.failing.map(({ ratio, required }) => [ratio, required]), [[4.49, 4.5]]);
  });
});
