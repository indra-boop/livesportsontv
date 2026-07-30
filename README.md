# LiveSportsOnTV Scraper

Node.js browser scraper for public sports fixtures and alternative
TV/streaming channels rendered on LiveSportsOnTV.

## Behavior

- Runs once every 24 hours at **00:00 WITA**.
- Fetches a rolling **7-day** window.
- Supports manual execution through `workflow_dispatch`.
- Upserts fixtures using `livesportsontv:{fixture_id}`.
- Preserves existing future fixtures that temporarily disappear from the feed.
- Refuses to write when the API returns an empty or invalid result.
- Retries transient requests three times.
- Keeps all stored timestamps in UTC.
- Does not use `RONIN_API_TOKEN` or any private API credential.

## Local usage

Requires Node.js 24 or newer.

```bash
npm ci
npx playwright install chromium
npm test
npm run scrape
npm run export:csv
```

Output:

```text
data/fixtures.json
exports/LiveSportsOnTV-Schedule-WITA.csv
```

The GitHub Actions workflow commits both files back to the `main` branch after
every successful run. The Excel workbook in `exports/` is a formatted snapshot;
the dependency-free CSV is regenerated automatically on every daily run.

## Data safety

Failed navigation, changed DOM selectors, invalid dates, and zero valid fixtures
terminate the job before the existing JSON file is replaced. Successful writes
use an atomic temporary-file rename. The scraper intentionally reads only
publicly rendered schedule content and does not follow `/go?` redirect URLs.

`robots.txt` and technical accessibility do not grant redistribution rights.
Confirm permitted use before redistributing the resulting data.
