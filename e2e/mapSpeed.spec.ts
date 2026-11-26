import { test, expect, type Page } from "@playwright/test";
import { answerConsent, continueAsGuest, openExplore } from "./helpers";

// Plan D33 step E: how smooth is the map with 2,000 pins? Needs a web build made with EXPO_PUBLIC_E2E_FAKE_PINS=1
// (npm run web:export with that set); the pins come from `?fakepins=2000` (lib/fakePins.ts). Without that build the
// test skips. Never runs against a production build: the flag is not in one.
//
// The camera is flown with the mouse (wheel zoom, drag pan) for about ten seconds while a requestAnimationFrame
// loop in the page records how long each frame took. Headless Chromium draws with software GL, so these numbers are
// a floor, not what a phone or a laptop with a graphics chip shows; the assertion (median >= 30 fps locally with a graphics chip, >= 5 on CI software GL) is the floor.

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1400, height: 900 },
  geolocation: { latitude: 12.9716, longitude: 77.5946 },
  permissions: ["geolocation"],
  // Real graphics chip when there is one (on unless CI); headless Chromium otherwise draws with software GL, which is several times slower.
  launchOptions: !process.env.CI ? { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-zero-copy"] } : {},
});

const PINS = Number(process.env.E2E_FAKE_PINS_COUNT || 2000);
const glMap = (page: Page) => page.locator("[data-zoom]").first();

test("the map stays smooth with 2,000 pins while the camera flies round", async ({ page }, info) => {
  test.skip(!process.env.E2E_FAKE_PINS_BUILD, "needs a web export built with EXPO_PUBLIC_E2E_FAKE_PINS=1; set E2E_FAKE_PINS_BUILD=1 when running");
  test.setTimeout(180_000);
  await page.goto(`/?fakepins=${PINS}`);
  await answerConsent(page);
  await continueAsGuest(page);
  await openExplore(page);
  // A guest is asked for location over the map; location is allowed here, so the prompt may or may not show.
  const notNow = page.getByRole("button", { name: "Not now", exact: true });
  await notNow.click({ timeout: 4000 }).catch(() => undefined);
  await expect(glMap(page)).toHaveAttribute("data-zoom", /\d/, { timeout: 30_000 });
  const box = (await glMap(page).boundingBox())!;
  const cx = box.x + box.width * 0.6;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  const zoom = async () => Number(await glMap(page).getAttribute("data-zoom"));
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: boolean };
    w.__frames = [];
    (w as unknown as { __marks: Record<string, number> }).__marks = {};
    w.__rec = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (!w.__rec) return;
      w.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const zooms: number[] = [await zoom()];
  const wheel = async (dy: number, steps: number) => {
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(90);
    }
  };
  const drag = async (dx: number, dy: number) => {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 25 });
    await page.mouse.up();
  };
  const mark = (name: string) => page.evaluate((n) => { const w = window as unknown as { __marks: Record<string, number>; __frames: number[] }; w.__marks[n] = w.__frames.length; }, name);
  const t0 = Date.now();
  await wheel(240, 14); // zoom out to the city
  zooms.push(await zoom());
  await mark("out");
  await drag(-260, 120);
  await wheel(-240, 12); // in to a district
  await drag(220, -140);
  await mark("district");
  await wheel(-240, 14); // in to the street, past where the pins spread
  zooms.push(await zoom());
  await mark("street");
  await drag(-300, -60);
  await drag(300, 80);
  await wheel(240, 6);
  await wheel(-240, 8);
  await drag(-200, 100);
  // Fill up to ten seconds of motion.
  while (Date.now() - t0 < 10_000) {
    await drag(180, 60);
    await drag(-180, -60);
  }
  const rec = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: boolean };
    w.__rec = false;
    return { all: w.__frames.slice(1), marks: (w as unknown as { __marks: Record<string, number> }).__marks };
  });
  const phases = Object.entries(rec.marks).map(([name, end], i, arr) => {
    const part = rec.all.slice(i ? arr[i - 1]![1] : 0, end).sort((a, b) => a - b);
    return `${name} ${part.length ? (1000 / part[Math.floor(part.length / 2)]!).toFixed(1) : "-"} fps`;
  });
  console.log("mapSpeed phases (median fps): " + phases.join(", "));

  const frames = rec.all;
  const sorted = [...frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const worst1 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!;
  const fps = 1000 / median;
  const summary = `mapSpeed: ${PINS} pins, ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s, zoom path ${zooms.map((z) => z.toFixed(1)).join(" > ")}, median ${median.toFixed(1)} ms = ${fps.toFixed(1)} fps, worst 1% frame ${worst1.toFixed(1)} ms (${(1000 / worst1).toFixed(1)} fps)`;
  console.log(summary);
  info.annotations.push({ type: "mapSpeed", description: summary });
  expect(frames.length).toBeGreaterThan(100);
  expect(zooms[2]!).toBeGreaterThan(zooms[1]!);
  expect(fps).toBeGreaterThanOrEqual(Number(process.env.E2E_MIN_FPS || (process.env.CI ? 5 : 30)));
});
