const cron = require('node-cron');
const sourcesModel = require('../models/sources');
const signalsModel = require('../models/signals');
const scanRunsModel = require('../models/scanRuns');
const feedService = require('./feedService');
const classificationService = require('./classificationService');
const webMonitorService = require('./webMonitorService');

let job = null;

async function pollFeeds(loadSources) {
  const start = Date.now();
  console.log('[poll] Starting feed poll...');
  try {
    const sources = await loadSources();
    feedService.invalidateCache();
    const [compFeeds, indFeeds] = await Promise.all([
      feedService.fetchCompetitorFeeds(sources),
      feedService.fetchIndustryFeeds(sources),
    ]);

    // Flatten all items with source metadata (same pattern as radar route)
    const allItems = [];
    Object.entries(compFeeds).forEach(([key, data]) => {
      if (!data.items) return;
      data.items.forEach(item => {
        allItems.push({ ...item, _sourceType: 'competitor', _sourceKey: key, _sourceName: data.name });
      });
    });
    indFeeds.forEach(item => {
      allItems.push({ ...item, _sourceType: 'industry' });
    });

    const classified = await classificationService.classifyRadarItems(allItems);
    const newSignals = classified.filter(item => item.link).map(item => ({
      title: item.title,
      link: item.link,
      pub_date: item.pubDate || null,
      snippet: item.snippet,
      quadrant: item.quadrant,
      relevance: item.relevance,
      label: item.label,
      source_name: item._sourceName || item.source,
      source_type: item._sourceType,
      source_key: item._sourceKey,
    }));
    const inserted = await signalsModel.createBatch(newSignals);
    const duration = Date.now() - start;
    await scanRunsModel.create({
      run_type: 'rss_poll',
      items_found: allItems.length,
      items_classified: inserted.length,
      duration_ms: duration,
    });
    console.log('[poll] Feed poll complete: ' + allItems.length + ' items, ' + inserted.length + ' new (' + duration + 'ms)');
  } catch (e) {
    console.error('[poll] Feed poll error:', e.message);
    await scanRunsModel.create({ run_type: 'rss_poll', errors: e.message, duration_ms: Date.now() - start }).catch(() => {});
  }
}

async function pollWebMonitors() {
  const start = Date.now();
  console.log('[poll] Starting web monitor poll...');
  try {
    const monitors = await sourcesModel.getByType('web_monitor');
    let changesFound = 0;
    for (const source of monitors) {
      try {
        const result = await webMonitorService.checkSource(source);
        if (result && result !== 'Initial snapshot captured') changesFound++;
        await sourcesModel.markPolled(source.id);
      } catch (e) {
        console.error('[poll] Web monitor error for ' + source.url + ': ' + e.message);
      }
    }
    const duration = Date.now() - start;
    await scanRunsModel.create({
      run_type: 'web_monitor',
      items_found: monitors.length,
      items_classified: changesFound,
      duration_ms: duration,
    });
    console.log('[poll] Web monitor complete: ' + monitors.length + ' pages, ' + changesFound + ' changes (' + duration + 'ms)');
  } catch (e) {
    console.error('[poll] Web monitor error:', e.message);
  }
}

function start(loadSources) {
  job = cron.schedule('*/30 * * * *', () => {
    pollFeeds(loadSources);
    pollWebMonitors();
  });
  console.log('[poll] Background polling started (every 30 min)');

  // Initial poll after 10s delay (replaces old feed pre-warm)
  setTimeout(() => {
    pollFeeds(loadSources);
    pollWebMonitors();
  }, 10000);
}

function stop() {
  if (job) {
    job.stop();
    job = null;
  }
}

module.exports = { start, stop, pollFeeds, pollWebMonitors };
