import { describe, it, expect, beforeEach } from 'vitest';
import { incCounter, setGauge, incGauge, observeHistogram, metricsToPrometheus } from './metrics.mjs';

describe('metrics - counter limits', () => {
  it('should create and increment counter', () => {
    incCounter('test_counter_total', { env: 'test' }, 1);
    incCounter('test_counter_total', { env: 'test' }, 2);
    const output = metricsToPrometheus();
    expect(output).toContain('test_counter_total{env="test"} 3');
  });
});

describe('metrics - gauge limits', () => {
  it('should respect MAX_GAUGE_ENTRIES (FIFO eviction)', () => {
    for (let i = 0; i < 5001; i++) {
      setGauge(`gauge_${i}`, i, { idx: String(i) });
    }
    const output = metricsToPrometheus();
    expect(output).toContain('gauge_5000');
    expect(output).not.toContain('gauge_0');
  });
});

describe('metrics - histogram limits', () => {
  it('should respect MAX_HISTOGRAM_ENTRIES (FIFO eviction)', () => {
    for (let i = 0; i < 501; i++) {
      observeHistogram(`hist_${i}`, 0.001, { idx: String(i) });
    }
    const output = metricsToPrometheus();
    expect(output).toContain('hist_500');
    expect(output).not.toContain('hist_0');
  });

  it('should cap observations at MAX_OBSERVATIONS per histogram', () => {
    for (let i = 0; i < 1100; i++) {
      observeHistogram('hist_observe_test', 0.01, {});
    }
    const output = metricsToPrometheus();
    const countMatch = output.match(/hist_observe_test_count\{?\}?\s+(\d+)/);
    expect(countMatch).not.toBeNull();
    expect(Number(countMatch[1])).toBe(1100);
  });
});

describe('metrics - label escaping', () => {
  it('should escape special characters in label values', () => {
    incCounter('test_escape', { val: 'he said "hello"\nworld' }, 1);
    const output = metricsToPrometheus();
    expect(output).toContain('test_escape{val="he said \\"hello\\"\\nworld"} 1');
  });
});

describe('metrics - metricsToPrometheus format', () => {
  it('should produce valid Prometheus exposition format', () => {
    const output = metricsToPrometheus();
    expect(output).toContain('# TYPE');
    expect(output.endsWith('\n')).toBe(true);
  });
});
