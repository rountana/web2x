import { describe, it, expect } from 'vitest';
import { parseTemporal } from '../../src/services/search/metadataStrategy.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

describe('parseTemporal', () => {
  it('returns no dates for queries with no temporal phrase', () => {
    const result = parseTemporal('articles about machine learning');
    expect(result.dateFrom).toBeUndefined();
    expect(result.dateTo).toBeUndefined();
  });

  it('parses "last week" as ~7 days ago', () => {
    const result = parseTemporal('articles from last week');
    expect(result.dateFrom).toBeDefined();
    const ageMs = Date.now() - new Date(result.dateFrom!).getTime();
    expect(ageMs).toBeGreaterThan(6 * DAY);
    expect(ageMs).toBeLessThan(8 * DAY);
  });

  it('parses "past 30 days"', () => {
    const result = parseTemporal('past 30 days of reading');
    expect(result.dateFrom).toBeDefined();
    const ageMs = Date.now() - new Date(result.dateFrom!).getTime();
    expect(ageMs).toBeGreaterThan(29 * DAY);
    expect(ageMs).toBeLessThan(31 * DAY);
  });

  it('parses "this month"', () => {
    const result = parseTemporal('this month I read about RAG');
    expect(result.dateFrom).toBeDefined();
    const ageMs = Date.now() - new Date(result.dateFrom!).getTime();
    expect(ageMs).toBeGreaterThan(29 * DAY);
    expect(ageMs).toBeLessThan(31 * DAY);
  });

  it('parses "recent" as 14 days ago', () => {
    const result = parseTemporal('recent articles');
    expect(result.dateFrom).toBeDefined();
    const ageMs = Date.now() - new Date(result.dateFrom!).getTime();
    expect(ageMs).toBeGreaterThan(13 * DAY);
    expect(ageMs).toBeLessThan(15 * DAY);
  });

  it('parses explicit after:YYYY-MM-DD as dateFrom', () => {
    const result = parseTemporal('articles after:2026-04-01');
    expect(result.dateFrom).toBe('2026-04-01T00:00:00.000Z');
  });

  it('parses explicit before:YYYY-MM-DD as dateTo', () => {
    const result = parseTemporal('articles before:2026-04-15');
    expect(result.dateTo).toBe('2026-04-15T23:59:59.999Z');
  });

  it('parses explicit after: + before: as a date range', () => {
    const result = parseTemporal('after:2026-04-01 before:2026-04-30');
    expect(result.dateFrom).toBe('2026-04-01T00:00:00.000Z');
    expect(result.dateTo).toBe('2026-04-30T23:59:59.999Z');
  });

  it('explicit date overrides relative phrase', () => {
    const result = parseTemporal('last week after:2026-04-01');
    expect(result.dateFrom).toBe('2026-04-01T00:00:00.000Z');
  });

  it('parses "today" as start of today UTC', () => {
    const result = parseTemporal('articles I read today');
    expect(result.dateFrom).toBeDefined();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    expect(new Date(result.dateFrom!).getTime()).toBe(today.getTime());
  });

  it('parses "yesterday" as a 24-hour window', () => {
    const result = parseTemporal('what did I read yesterday');
    expect(result.dateFrom).toBeDefined();
    expect(result.dateTo).toBeDefined();
    const fromTime = new Date(result.dateFrom!).getTime();
    const toTime = new Date(result.dateTo!).getTime();
    expect(toTime - fromTime).toBeCloseTo(DAY - 1, -2); // ~24h minus 1ms
  });

  it('clamps "past N days" to a maximum of 3650', () => {
    const result = parseTemporal('past 9999 days');
    expect(result.dateFrom).toBeDefined();
    const ageMs = Date.now() - new Date(result.dateFrom!).getTime();
    expect(ageMs).toBeLessThan(3651 * DAY);
  });
});
