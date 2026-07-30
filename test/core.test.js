import test from "node:test";
import assert from "node:assert/strict";
import { mergeFixtures, normalizeFixture } from "../src/core.js";

const NOW = new Date("2026-07-31T00:00:00.000Z");

test("normalizes a fixture and its alternative channels", () => {
  const result = normalizeFixture(
    {
      fixture_id: 42,
      title: "Home - Away",
      date: "2026-08-01T12:00:00.000Z",
      sport: "Soccer",
      league: "Test League",
      home_team: "Home",
      visiting_team: "Away",
      channels: [
        {
          id: 10,
          name: "Channel A",
          is_streaming: false,
          broadcast_start: "2026-08-01T11:55:00.000Z"
        },
        {
          id: 11,
          name: "Stream B",
          is_streaming: true
        }
      ]
    },
    NOW.toISOString()
  );

  assert.equal(result.sourceKey, "livesportsontv:42");
  assert.equal(result.channels.length, 2);
  assert.equal(result.channels[0].type, "tv");
  assert.equal(result.channels[1].type, "streaming");
});

test("upserts by sourceKey and retains other future fixtures", () => {
  const existing = [
    {
      sourceKey: "livesportsontv:42",
      title: "Old title",
      startAtUtc: "2026-08-01T12:00:00.000Z"
    },
    {
      sourceKey: "livesportsontv:99",
      title: "Still scheduled",
      startAtUtc: "2026-08-02T12:00:00.000Z"
    }
  ];
  const incoming = [
    {
      sourceKey: "livesportsontv:42",
      title: "Updated title",
      startAtUtc: "2026-08-01T12:00:00.000Z"
    }
  ];

  const merged = mergeFixtures(existing, incoming, NOW);

  assert.equal(merged.length, 2);
  assert.equal(
    merged.find((fixture) => fixture.sourceKey.endsWith(":42")).title,
    "Updated title"
  );
});

test("rejects an empty incoming result", () => {
  assert.throws(
    () => mergeFixtures([], [], NOW),
    /Empty result guard/
  );
});

test("prunes only fixtures older than the retention window", () => {
  const existing = [
    {
      sourceKey: "livesportsontv:1",
      startAtUtc: "2026-07-28T23:59:59.000Z"
    },
    {
      sourceKey: "livesportsontv:2",
      startAtUtc: "2026-07-29T00:00:00.000Z"
    }
  ];
  const incoming = [
    {
      sourceKey: "livesportsontv:3",
      startAtUtc: "2026-08-01T00:00:00.000Z"
    }
  ];

  const merged = mergeFixtures(existing, incoming, NOW);

  assert.deepEqual(
    merged.map((fixture) => fixture.sourceKey),
    ["livesportsontv:2", "livesportsontv:3"]
  );
});
