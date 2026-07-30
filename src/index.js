import {
  loadStore,
  mergeFixtures,
  normalizeFixture,
  SOURCE,
  writeStoreAtomic
} from "./core.js";

const API_BASE_URL =
  process.env.API_BASE_URL || "https://api2.roninmedia.io/2";
const API_TOKEN = process.env.RONIN_API_TOKEN;
const NUM_DAYS = parseInteger(process.env.NUM_DAYS || "7", "NUM_DAYS", 1, 31);
const OUTPUT_FILE = process.env.OUTPUT_FILE || "data/fixtures.json";
const MAX_ATTEMPTS = 3;

if (!API_TOKEN) {
  throw new Error("RONIN_API_TOKEN is required");
}

const runAt = new Date();
const rawFixtures = await fetchFixtures();
const normalizedFixtures = rawFixtures
  .map((fixture) => normalizeFixture(fixture, runAt.toISOString()))
  .filter(Boolean);

if (normalizedFixtures.length === 0) {
  throw new Error(
    `Empty result guard: API returned ${rawFixtures.length} raw fixtures and 0 valid fixtures`
  );
}

const currentStore = await loadStore(OUTPUT_FILE);
const mergedFixtures = mergeFixtures(
  currentStore.fixtures,
  normalizedFixtures,
  runAt
);

await writeStoreAtomic(OUTPUT_FILE, {
  metadata: {
    source: SOURCE,
    sourceUrl: "https://www.livesportsontv.com/",
    generatedAt: runAt.toISOString(),
    windowDays: NUM_DAYS,
    fetchedCount: rawFixtures.length,
    validCount: normalizedFixtures.length,
    storedCount: mergedFixtures.length,
    timezone: "UTC"
  },
  fixtures: mergedFixtures
});

console.log(
  `Saved ${mergedFixtures.length} fixtures (${normalizedFixtures.length} valid from ${rawFixtures.length} fetched) to ${OUTPUT_FILE}`
);

async function fetchFixtures() {
  const url = new URL("/2/fixtures", API_BASE_URL);
  url.searchParams.set("token", API_TOKEN);
  url.searchParams.set("numDays", String(NUM_DAYS));

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "Jerco-LiveSportsOnTV-Scraper/1.0"
        },
        signal: AbortSignal.timeout(30_000)
      });

      if (!response.ok) {
        throw new Error(`API returned HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error(`Unexpected content-type: ${contentType || "missing"}`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("API response must be an array");
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;

      const delayMs = [5_000, 15_000][attempt - 1];
      console.warn(
        `Fetch attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}; retrying in ${delayMs / 1000}s`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `Unable to fetch fixtures after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`,
    { cause: lastError }
  );
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
