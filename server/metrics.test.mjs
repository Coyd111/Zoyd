import { describe, it, expect } from 'vitest';
import {
  incCounter,
  setGauge,
  incGauge,
  decGauge,
  observeHistogram,
  startTimer,
  endTimer,
  metricsToPrometheus,
} from './metrics.mjs';

describe('metrics - Counters', () => {
  it('should increment a counter with no labels', () => {
    incCounter('test_counter_a');
    incCounter('test_counter_a');
    incCounter('test_counter_a');
    const out = metricsToPrometheus();
    expect(out).toContain('test_counter_a 3');
  });

  it('should increment a counter with labels', () => {
    incCounter('test_counter_b', { method: 'GET', status: '200' });
    incCounter('test_counter_b', { method: 'GET', status: '200' });
    incCounter('test_counter_b', { method: 'POST', status: '201' });
    const out = metricsToPrometheus();
    expect(out).toContain('test_counter_b{method="GET",status="200"} 2');
    expect(out).toContain('test_counter_b{method="POST",status="201"} 1');
  });

  it('should support custom increment amounts', () => {
    incCounter('test_counter_c', {}, 5);
    incCounter('test_counter_c', {}, 3);
    const out = metricsToPrometheus();
    expect(out).toContain('test_counter_c 8');
  });
});

describe('metrics - Gauges', () => {
  it('should set a gauge', () => {
    setGauge('test_gauge_a', 42);
    const out = metricsToPrometheus();
    expect(out).toContain('test_gauge_a 42');
  });

  it('should overwrite gauge value on set', () => {
    setGauge('test_gauge_b', 10);
    setGauge('test_gauge_b', 25);
    const out = metricsToPrometheus();
    expect(out).toContain('test_gauge_b 25');
  });

  it('should increment and decrement gauges', () => {
    setGauge('test_gauge_c', 100);
    incGauge('test_gauge_c', {}, 5);
    decGauge('test_gauge_c', {}, 3);
    const out = metricsToPrometheus();
    expect(out).toContain('test_gauge_c 102');
  });

  it('should support labeled gauges', () => {
    setGauge('test_gauge_d', 99, { instance: 'node1' });
    const out = metricsToPrometheus();
    expect(out).toContain('test_gauge_d{instance="node1"} 99');
  });
});

describe('metrics - Histograms', () => {
  it('should record observations', () => {
    observeHistogram('test_hist_a', 0.05);
    observeHistogram('test_hist_a', 0.15);
    observeHistogram('test_hist_a', 0.8);
    const out = metricsToPrometheus();
    expect(out).toContain('# TYPE test_hist_a histogram');
    expect(out).toContain('test_hist_a_count 3');
    expect(out).toContain('test_hist_a_sum 1');
  });

  it('should handle empty histogram', () => {
    const out = metricsToPrometheus();
    expect(out).toContain('test_hist_a_count 3');
  });
});

describe('metrics - Timer', () => {
  it('should measure elapsed time with endTimer', async () => {
    const start = startTimer();
    await new Promise(resolve => setTimeout(resolve, 10));
    endTimer('test_timer_a', start);
    const out = metricsToPrometheus();
    expect(out).toContain('test_timer_a_count 1');
    expect(out).toContain('test_timer_a_bucket');
    expect(out).toContain('test_timer_a_sum');
  });
});

describe('metrics - Prometheus output format', () => {
  it('should include TYPE declarations', () => {
    const out = metricsToPrometheus();
    expect(out).toContain('# TYPE');
    expect(out).toContain('counter');
    expect(out).toContain('gauge');
    expect(out).toContain('histogram');
  });

  it('should handle escaped label values', () => {
    incCounter('test_escape', { path: 'path with "quotes" and \\backslash' });
    const out = metricsToPrometheus();
    expect(out).toContain('path="path with \\"quotes\\" and \\\\backslash"');
  });

  it('should be valid UTF-8 text', () => {
    const out = metricsToPrometheus();
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
