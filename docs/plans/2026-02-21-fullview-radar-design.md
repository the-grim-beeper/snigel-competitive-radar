# Full-View Radar with Relevance Filtering — Design Document

## Overview

Make the radar the default landing page (full viewport), move the current dashboard to a secondary view, change relevance scoring to 1-10 integer scale, and add a user-adjustable threshold slider to filter low-relevance items.

## Navigation

- Two view modes: `radar` (default) and `dashboard`
- Single-page app, no router — toggle visibility of view containers
- Header stays visible in both views
- "DASHBOARD" button in radar view, "RADAR" button in dashboard view

## Radar View Layout

- Canvas fills ~calc(100vh - 80px) for header
- Legend + threshold slider positioned to the right on desktop, below on mobile
- Slider: min relevance 1-10, default 4
- Live item count updates as threshold changes

## Relevance Scale Change

- Backend: Claude prompt changed from 0.0-1.0 to 1-10 integer scale
- API response: `relevance` field becomes integer 1-10
- Frontend filtering: items below slider threshold excluded before rendering
- Distance mapping: `item._dist = 0.15 + (1 - relevance/10) * 0.7`

## Untouched

- Radar canvas rendering logic (quadrants, blips, sweep, tooltips, click)
- Dashboard view content (feeds, competitor cards, spider chart, timeline)
- Header action buttons (AI BRIEF, SOURCES, PROFILES, SCAN NOW)
