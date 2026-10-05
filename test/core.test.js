import test from "node:test";
import assert from "node:assert/strict";
import {
  addUtcDays,
  assertDayCoverage,
  createSettleTracker,
  mergeFixtures,
  normalizeFixture,
  parseDateButtonLabel,
  resolveNavigationStart,
  validateButtonDate
} from "../src/core.js";

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

test("accepts a multiline previous-day button just after midnight WITA", () => {
  const runAt = new Date("2026-08-24T16:35:15.000Z");
  const start = resolveNavigationStart("MON\n24", runAt);

  assert.equal(start.toISOString(), "2026-08-24T00:00:00.000Z");
  assert.doesNotThrow(() => validateButtonDate("TUE\n25", addUtcDays(start, 1)));
});

test("resolves navigation safely across a month and year boundary", () => {
  const runAt = new Date("2025-12-31T16:30:00.000Z");
  const start = resolveNavigationStart("WED 31", runAt);

  assert.equal(start.toISOString(), "2025-12-31T00:00:00.000Z");
  assert.doesNotThrow(() => validateButtonDate("THU 1", addUtcDays(start, 1)));
});

test("date navigation still fails closed on a wrong weekday or distant date", () => {
  const runAt = new Date("2026-08-24T16:35:15.000Z");

  assert.deepEqual(parseDateButtonLabel(" MON\n24 "), { weekday: "Mon", day: 24 });
  assert.throws(
    () => validateButtonDate("MON 25", new Date("2026-08-25T00:00:00.000Z")),
    /expected Tue 25/
  );
  assert.throws(
    () => resolveNavigationStart("FRI 21", runAt),
    /outside the WITA adjacent-day window/
  );
});

test("settle tracker waits for a non-empty list that stays the same", () => {
  const tracker = createSettleTracker({ stablePolls: 3 });

  // List is cleared right after the date click, then fills in.
  assert.equal(tracker.push(""), false);
  assert.equal(tracker.push(""), false);
  assert.equal(tracker.push(""), false);
  assert.equal(tracker.push("/match/a-1"), false);
  assert.equal(tracker.push("/match/a-1|/match/b-2"), false);
  assert.equal(tracker.push("/match/a-1|/match/b-2"), false);
  assert.equal(tracker.push("/match/a-1|/match/b-2"), true);
});

test("settle tracker never accepts the list shown before the click", () => {
  const previousDay = "/match/a-1|/match/b-2";
  const tracker = createSettleTracker({ stablePolls: 2, changedFrom: previousDay });

  // Previous day's list is still on screen: stable, but it is the wrong day.
  for (let poll = 0; poll < 5; poll += 1) {
    assert.equal(tracker.push(previousDay), false);
  }
  assert.equal(tracker.push(""), false);
  assert.equal(tracker.push("/match/c-3"), false);
  assert.equal(tracker.push("/match/c-3"), true);
});

test("settle tracker restarts its count when the list changes", () => {
  const tracker = createSettleTracker({ stablePolls: 3 });

  assert.equal(tracker.push("/match/a-1"), false);
  assert.equal(tracker.push("/match/a-1"), false);
  assert.equal(tracker.push("/match/a-1|/match/b-2"), false);
  assert.equal(tracker.push("/match/a-1|/match/b-2"), false);
  assert.equal(tracker.push("/match/a-1|/match/b-2"), true);
});

test("settle tracker accepts the same list again only after the grace period", () => {
  const sameDay = "/match/a-1|/match/b-2";
  const tracker = createSettleTracker({
    stablePolls: 2,
    changedFrom: sameDay,
    unchangedGracePolls: 4
  });

  // Re-selecting the day already shown: no reload happens, list stays as is.
  assert.equal(tracker.push(sameDay), false);
  assert.equal(tracker.push(sameDay), false);
  assert.equal(tracker.push(sameDay), false);
  assert.equal(tracker.push(sameDay), true);
});

test("settle tracker waits out a reload that brings the same list back", () => {
  const sameDay = "/match/a-1|/match/b-2";
  const tracker = createSettleTracker({
    stablePolls: 3,
    changedFrom: sameDay,
    unchangedGracePolls: 4
  });

  assert.equal(tracker.push(sameDay), false);
  assert.equal(tracker.push(""), false);
  assert.equal(tracker.push(""), false);
  assert.equal(tracker.push(""), false);
  assert.equal(tracker.push(sameDay), false);
  assert.equal(tracker.push(sameDay), false);
  assert.equal(tracker.push(sameDay), true);
});

test("day coverage guard fails a run that silently lost days", () => {
  // Shape of the 2026-10-04 run: only the first two days returned fixtures.
  const degraded = [
    { label: "SUN 04", count: 594 },
    { label: "MON 05", count: 118 },
    { label: "TUE 06", count: 0 },
    { label: "WED 07", count: 0 },
    { label: "THU 08", count: 0 },
    { label: "FRI 09", count: 0 },
    { label: "SAT 10", count: 0 }
  ];

  assert.throws(
    () => assertDayCoverage(degraded, 0),
    /Day coverage guard: 5 of 7 days returned 0 fixtures \(TUE 06, WED 07, THU 08, FRI 09, SAT 10\); allowed 0/
  );
});

test("day coverage guard passes full runs and honours the allowance", () => {
  const full = [
    { label: "MON 05", count: 224 },
    { label: "TUE 06", count: 45 }
  ];
  const oneEmpty = [...full, { label: "WED 07", count: 0 }];

  assert.doesNotThrow(() => assertDayCoverage(full, 0));
  assert.throws(() => assertDayCoverage(oneEmpty, 0), /1 of 3 days/);
  assert.doesNotThrow(() => assertDayCoverage(oneEmpty, 1));
});
