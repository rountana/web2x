import { describe, it, expect } from 'vitest';
import { parseConditions } from '../../src/services/search/csvStrategy.js';

describe('CSV parseConditions', () => {
  it('extracts a single equality condition', () => {
    const { conditions, remainder } = parseConditions('status = done');
    expect(conditions).toEqual([{ field: 'status', op: '=', value: 'done' }]);
    expect(remainder).toBe('');
  });

  it('extracts a numeric range condition', () => {
    const { conditions, remainder } = parseConditions('price > 100');
    expect(conditions).toEqual([{ field: 'price', op: '>', value: '100' }]);
    expect(remainder).toBe('');
  });

  it('handles multiple conditions in one query', () => {
    const { conditions } = parseConditions('status = active priority >= 3');
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toEqual({ field: 'status', op: '=', value: 'active' });
    expect(conditions[1]).toEqual({ field: 'priority', op: '>=', value: '3' });
  });

  it('preserves free text after stripping conditions as remainder', () => {
    const { conditions, remainder } = parseConditions('status = done meeting notes');
    expect(conditions).toEqual([{ field: 'status', op: '=', value: 'done' }]);
    expect(remainder).toBe('meeting notes');
  });

  it('supports quoted multi-word values', () => {
    const { conditions } = parseConditions('owner = "alice smith"');
    expect(conditions).toEqual([{ field: 'owner', op: '=', value: 'alice smith' }]);
  });

  it('lowercases field names but preserves value case', () => {
    const { conditions } = parseConditions('Status = DONE');
    expect(conditions[0].field).toBe('status');
    expect(conditions[0].value).toBe('DONE');
  });

  it('returns empty conditions when no patterns match', () => {
    const { conditions, remainder } = parseConditions('just some free text query');
    expect(conditions).toEqual([]);
    expect(remainder).toBe('just some free text query');
  });

  it('parses contains operator', () => {
    const { conditions } = parseConditions('title contains report');
    expect(conditions).toEqual([{ field: 'title', op: 'contains', value: 'report' }]);
  });

  it('handles all comparison operators', () => {
    const { conditions } = parseConditions('a = 1 b > 2 c < 3 d >= 4 e <= 5');
    expect(conditions.map((c) => c.op)).toEqual(['=', '>', '<', '>=', '<=']);
  });

  it('collapses whitespace in remainder', () => {
    const { remainder } = parseConditions('hello status = done world  extra');
    expect(remainder).toBe('hello world extra');
  });
});
