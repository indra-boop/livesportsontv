import { chromium } from "playwright";
import {
  addUtcDays,
  loadStore,
  mergeFixtures,
  resolveNavigationStart,
  SOURCE,
  validateButtonDate,
  writeStoreAtomic
} from "./core.js";
import { enrichChannelCountry } from "./channel-country.js";

const SOURCE_URL = "https://www.livesportsontv.com/";
const NUM_DAYS = parseInteger(process.env.NUM_DAYS || "7", "NUM_DAYS", 1, 10);
const OUTPUT_FILE = process.env.OUTPUT_FILE || "data/fixtures.json";
const NAVIGATION_TIMEOUT_MS = 60_000;

const runAt = new Date();
const browser = await chromium.launch({ headless: true });
let scrapedFixtures;

try {
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "Asia/Makassar",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  await page.goto(SOURCE_URL, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS
  });
  await page.locator('a[href^="/match/"]').first().waitFor({
    state: "visible",
    timeout: NAVIGATION_TIMEOUT_MS
  });

  scrapedFixtures = await scrapeDays(page, runAt);
} finally {
  await browser.close();
}

if (scrapedFixtures.length === 0) {
  throw new Error("Empty result guard: no visible fixtures were scraped");
}

const currentStore = await loadStore(OUTPUT_FILE);
const mergedFixtures = mergeFixtures(
  currentStore.fixtures,
  scrapedFixtures,
  runAt
);

await writeStoreAtomic(OUTPUT_FILE, {
  metadata: {
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    method: "rendered-html",
    generatedAt: runAt.toISOString(),
    windowDays: NUM_DAYS,
    scrapedCount: scrapedFixtures.length,
    storedCount: mergedFixtures.length,
    timezone: "UTC"
  },
  fixtures: mergedFixtures
});

console.log(
  `Saved ${mergedFixtures.length} fixtures (${scrapedFixtures.length} scraped) to ${OUTPUT_FILE}`
);

async function scrapeDays(page, scrapedAt) {
  const collected = new Map();
  const dateButtons = page
    .locator("button")
    .filter({ hasText: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s*\d{1,2}$/i });

  if ((await dateButtons.count()) < NUM_DAYS) {
    throw new Error("Date navigation is missing or its DOM structure changed");
  }

  const firstButtonText = (await dateButtons.first().innerText()).trim();
  const navigationStart = resolveNavigationStart(firstButtonText, scrapedAt);

  for (let dayIndex = 0; dayIndex < NUM_DAYS; dayIndex += 1) {
    const button = dateButtons.nth(dayIndex);
    const buttonText = (await button.innerText()).trim();
    const eventDate = addUtcDays(navigationStart, dayIndex);

    validateButtonDate(buttonText, eventDate);
    await button.click({ force: true });
    await page.waitForTimeout(1_200);

    const rawEvents = await page.evaluate(() => {
      const sportBlocks = [
        ...document.querySelectorAll(
          '[class*="FixtureListBySport_sport__"]'
        )
      ];
      const output = [];

      for (const sportBlock of sportBlocks) {
        const sport =
          sportBlock.querySelector(
            '[class*="SectionDivider_label__"]'
          )?.textContent?.trim() || "";
        const leagueCards = [
          ...sportBlock.querySelectorAll(':scope > [class*="Card_card__"]')
        ];

        for (const leagueCard of leagueCards) {
          const league =
            leagueCard.querySelector(
              '[class*="LeagueCard_cardTitleLink__"]'
            )?.textContent?.trim() || "";
          const eventElements = [
            ...leagueCard.querySelectorAll(
              '[class*="FixtureItem_container__"]'
            )
          ];

          for (const eventElement of eventElements) {
            if (eventElement.getClientRects().length === 0) continue;

            const link = eventElement.querySelector('a[href^="/match/"]');
            const title = link?.getAttribute("aria-label")?.trim();
            const href = link?.getAttribute("href");
            const time =
              eventElement.querySelector('[class*="FixtureItem_time__"]')
                ?.textContent?.trim() || "";
            const channelElements = [
              ...eventElement.querySelectorAll(
                '[class*="FixtureItem_channelChip__"]'
              )
            ];
            const channels = channelElements
              .map((element) => {
                const name =
                  element.querySelector(
                    '[class*="FixtureItem_channelChipText__"]'
                  )?.textContent?.trim() ||
                  element.querySelector("img")?.getAttribute("alt")?.trim() ||
                  "";
                const channelLink = element.closest("a");

                return {
                  name,
                  type: element.className.includes("nonStreaming")
                    ? "tv"
                    : "streaming",
                  sourceUrl: channelLink?.href || null
                };
              })
              .filter((channel) => channel.name);

            if (title && href && time) {
              output.push({
                sport,
                league,
                title,
                href,
                time,
                channels
              });
            }
          }
        }
      }

      return output;
    });

    let validForDay = 0;
    for (const rawEvent of rawEvents) {
      const normalized = normalizeRenderedEvent(
        rawEvent,
        eventDate,
        scrapedAt.toISOString()
      );
      if (!normalized) continue;

      collected.set(normalized.sourceKey, normalized);
      validForDay += 1;
    }

    console.log(
      `Day ${dayIndex + 1}/${NUM_DAYS} ${buttonText}: ${validForDay} fixtures`
    );
  }

  return [...collected.values()];
}

function normalizeRenderedEvent(rawEvent, eventDate, scrapedAt) {
  const sourceId = rawEvent.href.match(/-(\d+)$/)?.[1];
  const startAtUtc = parseWitaDateTime(eventDate, rawEvent.time);
  if (!sourceId || !startAtUtc || !rawEvent.title || !rawEvent.sport) {
    return null;
  }

  const [homeTeam, awayTeam] = splitTeams(rawEvent.title);
  const channels = deduplicateChannels(rawEvent.channels).map(
  (channel, index) => {
    const enriched = enrichChannelCountry(channel);
    return {
      id: `${sourceId}:${index + 1}`,
      name: enriched.name,
      countryCode: enriched.countryCode,
      displayName: enriched.displayName,
      slug: null,
      type: channel.type,
      broadcastStartUtc: null,
      sourceUrl: channel.sourceUrl
    };
  }
);

  return {
    source: SOURCE,
    sourceId,
    sourceKey: `${SOURCE}:${sourceId}`,
    title: rawEvent.title,
    sport: rawEvent.sport,
    sportSlug: slugify(rawEvent.sport),
    league: rawEvent.league || null,
    leagueSlug: rawEvent.league ? slugify(rawEvent.league) : null,
    homeTeam,
    awayTeam,
    startAtUtc,
    status: null,
    venue: null,
    channels,
    sourceUpdatedAt: null,
    scrapedAt,
    sourceUrl: new URL(rawEvent.href, SOURCE_URL).href
  };
}

function parseWitaDateTime(date, text) {
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const minute = Number(match[2]);

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      hour - 8,
      minute
    )
  ).toISOString();
}

function splitTeams(title) {
  const separatorIndex = title.indexOf(" - ");
  if (separatorIndex === -1) return [null, null];
  return [
    title.slice(0, separatorIndex).trim() || null,
    title.slice(separatorIndex + 3).trim() || null
  ];
}

function deduplicateChannels(channels) {
  const unique = new Map();
  for (const channel of Array.isArray(channels) ? channels : []) {
    const key = channel.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (key && !unique.has(key)) unique.set(key, channel);
  }
  return [...unique.values()];
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseInteger(value, name, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isInteger(parsed) ||
    String(parsed) !== String(value).trim() ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}
