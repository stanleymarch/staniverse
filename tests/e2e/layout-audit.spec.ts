import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/works/",
  "/projects/",
  "/about/",
  "/donate/",
  "/garden/",
  "/universe/",
  "/topics/",
  "/topics/iskusstvennyi-intellekt/",
  "/works/virtualnyy-ofis-advokata/",
  "/projects/albina/",
  "/articles/ai-waifu/",
  "/garden/telegram/tg-743/",
  "/garden/telegram/tg-1115/",
  "/garden/video/youtube-ncq31xb3gle/",
] as const;

for (const route of routes) {
  test(`layout geometry remains readable: ${route}`, async ({ page }, testInfo) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1").first(), `${route}: page has a visible primary heading`).toBeVisible();
    await expect(page.locator("body"), `${route}: no framework error page`).not.toContainText("An error occurred");
    const depthThree = page.locator('[data-depth-button="3"]');
    if (await depthThree.count()) await depthThree.click();

    const audit = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && box.width > 1 && box.height > 1;
      };
      const ignored = (element: Element) => Boolean(element.closest(".garden-map-viewport, .catalog-controls, .universe-page, .card-orbit, [hidden]"));
      const outside = [...document.body.querySelectorAll("body *")]
        .filter((element) => visible(element) && !ignored(element))
        .flatMap((element) => {
          const box = element.getBoundingClientRect();
          return box.left < -1 || box.right > viewportWidth + 1
            ? [{ tag: element.tagName, className: element.className?.toString().slice(0, 100), left: Math.round(box.left), right: Math.round(box.right) }]
            : [];
        });
      const headings = [...document.querySelectorAll("h1, h2")]
        .filter(visible)
        .map((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { text: element.textContent?.trim().slice(0, 80), tag: element.tagName, size: Number.parseFloat(style.fontSize), width: box.width, scrollWidth: element.scrollWidth };
        });
      const graph = document.querySelector(".local-graph__stage");
      const graphBox = graph?.getBoundingClientRect();
      const graphNodesOutside = graphBox ? [...graph!.querySelectorAll<HTMLElement>(".local-graph__node:not([hidden])")].flatMap((node) => {
        const box = node.getBoundingClientRect();
        return box.left < graphBox.left - 1 || box.right > graphBox.right + 1 || box.top < graphBox.top - 1 || box.bottom > graphBox.bottom + 1
          ? [{ title: node.textContent?.trim(), left: box.left - graphBox.left, right: box.right - graphBox.right, top: box.top - graphBox.top, bottom: box.bottom - graphBox.bottom }]
          : [];
      }) : [];
      const graphNodeBoxes = graphBox ? [...graph!.querySelectorAll<HTMLElement>(".local-graph__node:not([hidden])")].map((node) => ({ title: node.textContent?.trim(), box: node.getBoundingClientRect() })) : [];
      const graphOverlaps = graphNodeBoxes.flatMap((node, index) => graphNodeBoxes.slice(index + 1).flatMap((other) => {
        const overlaps = node.box.left < other.box.right && node.box.right > other.box.left && node.box.top < other.box.bottom && node.box.bottom > other.box.top;
        return overlaps ? [`${node.title} <> ${other.title}`] : [];
      }));
      return { outside, headings, graphNodesOutside, graphOverlaps, viewportWidth };
    });

    expect(audit.outside, `${route}: elements outside viewport`).toEqual([]);
    expect(audit.graphNodesOutside, `${route}: local graph nodes outside stage`).toEqual([]);
    expect(audit.graphOverlaps, `${route}: local graph nodes overlap`).toEqual([]);
    const headingLimit = audit.viewportWidth <= 430 ? 50 : audit.viewportWidth <= 800 ? 78 : 150;
    expect(audit.headings.filter((heading) => heading.size > headingLimit), `${route}: oversized headings`).toEqual([]);
    expect(audit.headings.filter((heading) => heading.scrollWidth > heading.width + 1), `${route}: clipped headings`).toEqual([]);

    if (testInfo.project.name === "mobile") {
      await page.screenshot({ path: testInfo.outputPath("page.png"), fullPage: true });
      if (await page.locator(".local-graph-v2").count()) await page.locator(".local-graph-v2").screenshot({ path: testInfo.outputPath("local-graph.png") });
    }
  });
}
