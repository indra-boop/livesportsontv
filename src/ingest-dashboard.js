import { readFile } from "node:fs/promises";

/**
 * Kirim fixtures hasil scrape ke aggregator dashboard.
 *
 * Fixture dikirim apa adanya. normalizeFixture() di src/core.js sudah
 * menghasilkan bentuk yang dibaca adaptLiveSportsOnTv() di
 * lib/sports-aggregator/core.mjs pada sisi aggregator: startAtUtc, sourceKey,
 * sport, league, homeTeam/awayTeam, channels[{name,countryCode,displayName}],
 * sourceUrl, scrapedAt. Konversi UTC -> WITA dan penentuan country code
 * dikerjakan di sana, jadi skrip ini sengaja TIDAK mentransformasi apa pun.
 * Menduplikasi logika itu di sini akan membuat dua sumber kebenaran.
 *
 * Setiap kegagalan keluar dengan exit code non-zero supaya run merah dan
 * terlihat, meniru pola sendToDashboard() di ausport-scraper.
 */

const INPUT_FILE = process.env.INPUT_FILE || "data/fixtures.json";
const INGEST_URL = (process.env.DASHBOARD_INGEST_URL || "").trim();
const INGEST_TOKEN = (process.env.DASHBOARD_INGEST_TOKEN || "").trim();
const SOURCE_NAME = "livesportsontv";

// Batas server: MAX_EVENTS_PER_SYNC = 2000 di services/aggregator-api/server.mjs.
// Payload TIDAK dipecah jadi beberapa batch: ingestSnapshot() memperlakukan satu
// POST sebagai satu snapshot penuh per source, jadi batch kedua berpotensi
// menghapus batch pertama. Lebih baik gagal keras daripada kehilangan data.
const MAX_EVENTS_PER_SYNC = 2000;

const MINIMUM_FIXTURES = Number.parseInt(
  process.env.MINIMUM_INGEST_FIXTURES || "200",
  10,
);
const REQUEST_TIMEOUT_MS = 60_000;
const RETRIES = 3;

const dryRun = process.argv.includes("--dry-run");

function fail(message) {
  console.error(
    "Dashboard ingest failure: " +
      JSON.stringify({
        source: SOURCE_NAME,
        error: message,
        at: new Date().toISOString(),
        nonFatal: false,
      }),
  );
  process.exit(1);
}

async function post(fixtures) {
  let lastError = null;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(INGEST_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${INGEST_TOKEN}`,
          "content-type": "application/json",
          "user-agent": "jerco-livesportsontv-ingest/1.0",
        },
        body: JSON.stringify({ source: SOURCE_NAME, events: fixtures }),
      });

      const text = await response.text();
      let document = null;
      try {
        document = text ? JSON.parse(text) : null;
      } catch {
        document = { raw: text.slice(0, 500) };
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${text.slice(0, 500)}`;
        // 401 = token salah, 400/413/422 = payload ditolak. Retry tidak menolong.
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) break;
      } else {
        console.log(
          "Dashboard ingest success: " +
            JSON.stringify({
              status: response.status,
              durationMs: Date.now() - startedAt,
              fixtures: fixtures.length,
              response: document,
            }),
        );
        return;
      }
    } catch (error) {
      lastError = error?.name === "AbortError"
        ? `Timeout setelah ${REQUEST_TIMEOUT_MS} ms`
        : (error?.message || String(error));
    } finally {
      clearTimeout(timer);
    }

    console.error(
      `[warning] Ingest attempt ${attempt}/${RETRIES} gagal: ${lastError}`,
    );
    if (attempt < RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** (attempt - 1) * 1000));
    }
  }

  fail(`Ingest gagal setelah ${RETRIES} percobaan: ${lastError}`);
}

let store;
try {
  store = JSON.parse(await readFile(INPUT_FILE, "utf8"));
} catch (error) {
  fail(`Tidak bisa membaca ${INPUT_FILE}: ${error.message}`);
}

const fixtures = Array.isArray(store?.fixtures) ? store.fixtures : [];
const generatedAt = store?.metadata?.generatedAt || "unknown";

console.log(
  `[info] ${INPUT_FILE}: ${fixtures.length} fixtures (generatedAt ${generatedAt})`,
);

if (fixtures.length < MINIMUM_FIXTURES) {
  fail(
    `Fixture guard: ${fixtures.length} fixtures < ambang ${MINIMUM_FIXTURES}. ` +
      `Scrape kemungkinan rusak; ingest dibatalkan.`,
  );
}

if (fixtures.length > MAX_EVENTS_PER_SYNC) {
  fail(
    `${fixtures.length} fixtures melebihi batas ${MAX_EVENTS_PER_SYNC} event per ` +
      `sync. Payload tidak dipecah karena satu POST = satu snapshot penuh per ` +
      `source. Persempit NUM_DAYS atau RETENTION_MS.`,
  );
}

if (dryRun) {
  const sample = fixtures[0];
  console.log(
    "[dry-run] Contoh fixture: " +
      JSON.stringify({
        sourceKey: sample?.sourceKey,
        startAtUtc: sample?.startAtUtc,
        sport: sample?.sport,
        title: sample?.title,
        channels: (sample?.channels || []).map((channel) => channel.displayName),
      }),
  );
  console.log("[dry-run] Tidak ada yang dikirim.");
  process.exit(0);
}

if (!INGEST_URL) fail("DASHBOARD_INGEST_URL belum di-set");
if (!INGEST_TOKEN) fail("DASHBOARD_INGEST_TOKEN belum di-set");

await post(fixtures);
