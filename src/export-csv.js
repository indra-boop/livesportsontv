import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const INPUT_FILE = process.env.INPUT_FILE || "data/fixtures.json";
const OUTPUT_FILE =
  process.env.CSV_OUTPUT_FILE || "exports/LiveSportsOnTV-Schedule-WITA.csv";

const store = JSON.parse(await readFile(INPUT_FILE, "utf8"));
const fixtures = Array.isArray(store.fixtures) ? store.fixtures : [];

if (fixtures.length === 0) {
  throw new Error("CSV export guard: no fixtures available");
}

const headers = [
  "No.",
  "Start WITA",
  "Hari",
  "Sport",
  "League",
  "Event",
  "Home Team",
  "Away Team",
  "Status",
  "Venue",
  "Channel Count",
  "All Channels",
  "Streaming Channels",
  "TV Channels",
  "Start UTC",
  "Source Key"
];

const rows = fixtures.map((fixture, index) => {
  const channels = Array.isArray(fixture.channels) ? fixture.channels : [];
  const streaming = channels
    .filter((channel) => channel.type === "streaming")
    .map((channel) => channel.name);
  const television = channels
    .filter((channel) => channel.type !== "streaming")
    .map((channel) => channel.name);

  return [
    index + 1,
    formatWita(fixture.startAtUtc),
    weekdayWita(fixture.startAtUtc),
    fixture.sport || "",
    fixture.league || "",
    fixture.title || "",
    fixture.homeTeam || "",
    fixture.awayTeam || "",
    fixture.status || "",
    fixture.venue || "",
    channels.length,
    channels.map((channel) => channel.name).join(", "),
    streaming.join(", "),
    television.join(", "),
    fixture.startAtUtc || "",
    fixture.sourceKey || ""
  ];
});

const csv = [headers, ...rows]
  .map((row) => row.map(csvCell).join(","))
  .join("\r\n");

await mkdir(dirname(OUTPUT_FILE), { recursive: true });
await writeFile(OUTPUT_FILE, `\uFEFF${csv}\r\n`, "utf8");

console.log(`Saved ${rows.length} schedule rows to ${OUTPUT_FILE}`);

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function formatWita(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function weekdayWita(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Makassar",
    weekday: "long"
  }).format(date);
}
