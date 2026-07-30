import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

export const SOURCE = "livesportsontv";
export const RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

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
