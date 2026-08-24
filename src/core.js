import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

export const SOURCE = "livesportsontv";
export const RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseDateButtonLabel(value) {
  const compact = String(value || "").replace(/\s+/g, "").trim();
  const match = compact.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(\d{1,2})$/i);
  if (!match) return null;

  return {
    weekday: match[1].slice(0, 1).toUpperCase() + match[1].slice(1).toLowerCase(),
    day: Number(match[2])
  };
}

/**
 * Resolve the first navigation button near today's WITA calendar date.
 * The site can still show the previous UTC/US day during the first minutes
 * after midnight WITA, so a valid adjacent day is accepted only when both
 * its weekday and day-of-month match.
 */
export function resolveNavigationStart(buttonText, reference = new Date()) {
  const label = parseDateButtonLabel(buttonText);
  if (!label) {
    throw new Error(`Date navigation label is invalid: ${buttonText}`);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(reference);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const witaDate = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));

  for (const offset of [-1, 0, 1]) {
    const candidate = addUtcDays(witaDate, offset);
    if (
      candidate.getUTCDate() === label.day &&
      DAY_LABELS[candidate.getUTCDay()] === label.weekday
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Date navigation start is outside the WITA adjacent-day window: received ${buttonText}`
  );
}

export function validateButtonDate(buttonText, date) {
  const label = parseDateButtonLabel(buttonText);
  const expectedDay = date.getUTCDate();
  const expectedWeekday = DAY_LABELS[date.getUTCDay()];
  if (!label || label.day !== expectedDay || label.weekday !== expectedWeekday) {
    throw new Error(
      `Date navigation mismatch: expected ${expectedWeekday} ${String(expectedDay).padStart(2, "0")}, received ${buttonText}`
    );
  }
}

export function addUtcDays(date, days) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days
  ));
}

export function normalizeFixture(fixture, scrapedAt = new Date().toISOString()) {
  if (!fixture || fixture.fixture_id == null) return null;

  const startAtUtc = toIsoOrNull(fixture.date);
  if (!fixture.title || !fixture.sport || !startAtUtc) return null;

  const channels = Array.isArray(fixture.channels)
    ? fixture.channels
        .filter((channel) => channel?.id != null && channel?.name)
        .map((channel) => ({
          id: String(channel.id),
          name: channel.name,
          slug: channel.url_slug || null,
          type: channel.is_streaming ? "streaming" : "tv",
          broadcastStartUtc: toIsoOrNull(channel.broadcast_start),
          sourceUrl: channel.url || null
        }))
    : [];

  return {
    source: SOURCE,
    sourceId: String(fixture.fixture_id),
    sourceKey: `${SOURCE}:${fixture.fixture_id}`,
    title: fixture.title,
    sport: fixture.sport,
    sportSlug: fixture.sport_slug || null,
    league: fixture.league || null,
    leagueSlug: fixture.league_slug || null,
    homeTeam: fixture.home_team || null,
    awayTeam: fixture.visiting_team || null,
    startAtUtc,
    status: fixture.status || null,
    venue: fixture.venue || null,
    channels,
    sourceUpdatedAt: toIsoOrNull(fixture.last_updated),
    scrapedAt
  };
}

export function mergeFixtures(existingFixtures, incomingFixtures, now = new Date()) {
  if (!Array.isArray(incomingFixtures) || incomingFixtures.length === 0) {
    throw new Error("Empty result guard: refusing to replace existing data");
  }

  const merged = new Map();

  for (const fixture of Array.isArray(existingFixtures) ? existingFixtures : []) {
    if (fixture?.sourceKey) merged.set(fixture.sourceKey, fixture);
  }

  for (const fixture of incomingFixtures) {
    if (fixture?.sourceKey) merged.set(fixture.sourceKey, fixture);
  }

  const retentionThreshold = now.getTime() - RETENTION_MS;

  return [...merged.values()]
    .filter((fixture) => {
      const start = Date.parse(fixture.startAtUtc);
      return Number.isFinite(start) && start >= retentionThreshold;
    })
    .sort((a, b) => {
      const timeDifference = Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc);
      return timeDifference || a.sourceKey.localeCompare(b.sourceKey);
    });
}

export async function loadStore(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return {
      metadata: parsed?.metadata || {},
      fixtures: Array.isArray(parsed?.fixtures) ? parsed.fixtures : []
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { metadata: {}, fixtures: [] };
    throw new Error(`Cannot read ${path}: ${error.message}`, { cause: error });
  }
}

export async function writeStoreAtomic(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function toIsoOrNull(value) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}
