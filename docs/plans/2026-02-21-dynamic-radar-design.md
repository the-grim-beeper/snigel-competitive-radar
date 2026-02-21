# Dynamic News Radar — Design Document

## Overview

Transform the static competitor-position radar into a dynamic news radar where blips represent classified news items from RSS feed analysis, divided into 4 quadrants.

## Quadrants

| Quadrant | Angle Range | Color | Content |
|----------|------------|-------|---------|
| Competitors | 0-90 (top-right) | #ef4444 red | News about tracked competitors |
| Industry Events | 90-180 (bottom-right) | #38bdf8 blue | Defense/procurement/trade show news |
| Snigel Direct | 180-270 (bottom-left) | #00e5a0 green | News mentioning Snigel directly |
| General/Anomalies | 270-360 (top-left) | #f0a500 amber | Unexpected or cross-cutting signals |

## Data Flow

1. Feed refresh triggers (existing 15-min TTL cache)
2. Collect all items from competitor + industry feeds
3. Batch into chunks of ~40 items for token safety
4. Claude classifies each item: quadrant + relevance score (0-1) + short label
5. Merge chunked results into unified radar items array
6. Cache in `cache.radar` (same 15-min TTL)
7. Frontend fetches `/api/radar` and draws blips

## Backend

### Classification function: `classifyRadarItems(items)`

- Input: flat array of feed items (title, link, pubDate, snippet, source)
- Chunks into batches of ~40 items
- Parallel Claude calls per chunk
- Each call returns JSON array: `{ index, quadrant, relevance, label }`
- Merges chunk results back into unified array
- Graceful fallback if no API key: infer quadrant from feed source, set relevance 0.5

### New endpoint: `GET /api/radar`

- Calls existing `fetchCompetitorFeeds()` + `fetchIndustryFeeds()`
- Flattens all items with source metadata
- Runs `classifyRadarItems()`
- Returns `{ ok, timestamp, items }` where each item has quadrant, relevance, label, title, link, pubDate
- Cached in `cache.radar`, invalidated when feed caches are invalidated

### Claude classification output per item

```json
{
  "index": 0,
  "quadrant": "competitors|industry|snigel|anomalies",
  "relevance": 0.72,
  "label": "NFM acquires French firm"
}
```

## Frontend

### Radar canvas changes

- 4 dividing lines (cross pattern) replacing 6 spokes
- Quadrant labels along edges
- Concentric rings remain (distance from center = relevance, closer = more relevant)
- Sweep line animation preserved
- Blips show short label text, size varies by relevance
- Click blip to open article link
- Hover tooltip shows full headline

### Legend

Changes from competitor names to 4 quadrant categories with colors.

### Untouched

Competitor cards, spider chart, timeline, brief modal, source management — all unchanged.

## Token Limit Handling

- Each item is ~80-120 tokens (title + 150-char snippet)
- Chunks of 40 items = ~5K tokens input per call
- Well within Sonnet's 200K context window
- Parallel chunk processing keeps latency low
- If total items < 40, single API call
