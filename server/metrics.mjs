// server/metrics.mjs — Lightweight Prometheus-compatible metrics (zero deps)
// Exposes /metrics endpoint in Prometheus exposition format.

import { createLogger } from './logger.mjs';

const log = createLogger('metrics');

// ─── Counters ────────────────────────────────────────────────────────────────
const counters = new Map();
const MAX_COUNTER_ENTRIES = 5000;
const getCounter = (name, labels = {}) => {
  const key = name + '|' + JSON.stringify(labels);
  if (!counters.has(key)) {
    if (counters.size >= MAX_COUNTER_ENTRIES) {
      const first = counters.keys().next().value;
      counters.delete(first);
    }
    counters.set(key, { name, labels, value: 0 });
  }
  return counters.get(key);
};

export const incCounter = (name, labels = {}, amount = 1) => {
  const c = getCounter(name, labels);
  c.value += amount;
};

// ─── Gauges ──────────────────────────────────────────────────────────────────
const gauges = new Map();
const MAX_GAUGE_ENTRIES = 5000;

export const setGauge = (name, value, labels = {}) => {
  const key = name + '|' + JSON.stringify(labels);
  if (!gauges.has(key)) {
    if (gauges.size >= MAX_GAUGE_ENTRIES) {
      const first = gauges.keys().next().value;
      gauges.delete(first);
    }
  }
  gauges.set(key, { name, labels, value });
};

export const incGauge = (name, labels = {}, amount = 1) => {
  const key = name + '|' + JSON.stringify(labels);
  const existing = gauges.get(key);
  const val = existing ? existing.value + amount : amount;
  gauges.set(key, { name, labels, value: val });
};

export const decGauge = (name, labels = {}, amount = 1) => {
  incGauge(name, labels, -amount);
};

// ─── Histograms (buckets in seconds) ─────────────────────────────────────────
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const histograms = new Map();
const MAX_HISTOGRAM_ENTRIES = 500;

const getHistogram = (name, labels = {}, buckets = DEFAULT_BUCKETS) => {
  const key = name + '|' + JSON.stringify(labels);
  if (!histograms.has(key)) {
    if (histograms.size >= MAX_HISTOGRAM_ENTRIES) {
      const first = histograms.keys().next().value;
      histograms.delete(first);
    }
    histograms.set(key, {
      name, labels, buckets,
      observations: [],
      sum: 0,
      count: 0,
    });
  }
  return histograms.get(key);
};

const MAX_OBSERVATIONS = 1000;

export const observeHistogram = (name, value, labels = {}) => {
  const h = getHistogram(name, labels);
  if (h.observations.length >= MAX_OBSERVATIONS) {
    // Use slice instead of shift (O(1) amortized vs O(n))
    h.observations = h.observations.slice(-MAX_OBSERVATIONS + 1);
  }
  h.observations.push(value);
  h.sum += value;
  h.count += 1;
};

// ─── Timer helper ────────────────────────────────────────────────────────────
export const startTimer = () => process.hrtime.bigint();

export const endTimer = (name, start, labels = {}) => {
  const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
  observeHistogram(name, elapsed, labels);
};

// ─── Format as Prometheus text exposition ────────────────────────────────────
const escapeLabelValue = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

const formatLabels = (labels) => {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  const pairs = keys.map(k => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${pairs.join(',')}}`;
};

export const metricsToPrometheus = () => {
  const lines = [];
  const seen = new Set();

  // Counters
  for (const c of counters.values()) {
    const metricName = c.name;
    if (!seen.has(metricName)) {
      lines.push(`# TYPE ${metricName} counter`);
      seen.add(metricName);
    }
    lines.push(`${metricName}${formatLabels(c.labels)} ${c.value}`);
  }

  // Gauges
  for (const g of gauges.values()) {
    const metricName = g.name;
    if (!seen.has(metricName)) {
      lines.push(`# TYPE ${metricName} gauge`);
      seen.add(metricName);
    }
    lines.push(`${metricName}${formatLabels(g.labels)} ${g.value}`);
  }

  // Histograms
  for (const h of histograms.values()) {
    const metricName = h.name;
    const baseLabels = formatLabels(h.labels);
    if (!seen.has(metricName)) {
      lines.push(`# TYPE ${metricName} histogram`);
      seen.add(metricName);
    }
    // Sort observations once for efficient binary search per bucket
    const sorted = [...h.observations].sort((a, b) => a - b);
    let cumulative = 0;
    let searchIdx = 0;
    for (const b of h.buckets) {
      // Advance pointer instead of filtering entire array
      while (searchIdx < sorted.length && sorted[searchIdx] <= b) {
        cumulative++;
        searchIdx++;
      }
      const bLabels = formatLabels({ ...h.labels, le: b });
      lines.push(`${metricName}_bucket${bLabels} ${cumulative}`);
    }
    // +Inf bucket
    lines.push(`${metricName}_bucket${formatLabels({ ...h.labels, le: '+Inf' })} ${h.count}`);
    // sum and count
    lines.push(`${metricName}_sum${baseLabels} ${h.sum}`);
    lines.push(`${metricName}_count${baseLabels} ${h.count}`);
  }

  return lines.join('\n') + '\n';
};

// ─── Auto-collect basic server metrics ───────────────────────────────────────
let startTime = Date.now();

export const collectServerMetrics = () => {
  setGauge('zoyd_uptime_seconds', (Date.now() - startTime) / 1000);
  setGauge('zoyd_node_heap_used_bytes', process.memoryUsage().heapUsed);
  setGauge('zoyd_node_heap_total_bytes', process.memoryUsage().heapTotal);
  setGauge('zoyd_node_rss_bytes', process.memoryUsage().rss);
  setGauge('zoyd_node_external_bytes', process.memoryUsage().external);
};

// Periodic cleanup: reset gauges and trim histograms to prevent unbounded growth
const cleanupMetrics = () => {
  // Reset server gauges (they're re-collected every 15s anyway)
  const serverGaugePrefixes = ['zoyd_uptime_', 'zoyd_node_'];
  for (const [key] of gauges) {
    if (serverGaugePrefixes.some(p => key.startsWith(p + '|'))) {
      gauges.delete(key);
    }
  }
  // Trim histograms that exceed max observations
  for (const [key, h] of histograms) {
    if (h.observations.length > MAX_OBSERVATIONS) {
      h.observations = h.observations.slice(-MAX_OBSERVATIONS);
    }
  }
};

// Collect every 15 seconds
setInterval(collectServerMetrics, 15_000);
// Cleanup every 5 minutes
setInterval(cleanupMetrics, 5 * 60 * 1000);
collectServerMetrics();

log.info('Metrics collector initialized');
