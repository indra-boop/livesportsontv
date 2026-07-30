# LiveSportsOnTV Scraper

Node.js ingestor for sports fixtures and alternative TV/streaming channels from
LiveSportsOnTV's data provider.

## Behavior

- Runs once every 24 hours at **00:00 WITA**.
- Fetches a rolling **7-day** window.
- Supports manual execution through `workflow_dispatch`.
- Upserts fixtures using `livesportsontv:{fixture_id}`.
- Preserves existing future fixtures that temporarily disappear from the feed.
- Refuses to write when the API returns an empty or invalid result.
- Retries transient requests three times.
- Keeps all stored timestamps in UTC.

## Required GitHub secret

Create this repository secret:

```text
RONIN_API_TOKEN
```

Use an API token issued or licensed by Ronin Sport. Do not copy credentials from
website assets or commit tokens to this repository.

Repository path:

```text
Settings → Secrets and variables → Actions → New repository secret
```

## Local usage

Requires Node.js 24 or newer.

```bash
cp .env.example .env
set -a
. ./.env
set +a

npm test
npm run scrape
```

PowerShell:

```powershell
$env:RONIN_API_TOKEN="your-licensed-token"
$env:NUM_DAYS="7"

npm test
npm run scrape
```

Output:

```text
data/fixtures.json
```

## Data safety

Failed requests, non-JSON responses, invalid payloads, and zero valid fixtures
terminate the job before the existing JSON file is replaced. Successful writes
use an atomic temporary-file rename.

`robots.txt` and technical accessibility do not grant redistribution rights.
Confirm API licensing and permitted use before publishing the resulting data.
