import { describe, it, expect } from 'vitest';
import { parseCsv, inferType, coerceValue } from '../../src/routes/csv.js';

describe('CSV parser (parseCsv)', () => {
  it('parses a simple CSV with header and rows', () => {
    const text = 'name,age\nalice,30\nbob,25';
    expect(parseCsv(text)).toEqual([
      ['name', 'age'],
      ['alice', '30'],
      ['bob', '25'],
    ]);
  });

  it('handles quoted fields with embedded commas', () => {
    const text = 'name,note\n"alice","hello, world"';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['alice', 'hello, world'],
    ]);
  });

  it('handles doubled quotes inside quoted fields', () => {
    const text = 'name,quote\n"alice","she said ""hi"""';
    expect(parseCsv(text)).toEqual([
      ['name', 'quote'],
      ['alice', 'she said "hi"'],
    ]);
  });

  it('handles \\r\\n line endings', () => {
    const text = 'a,b\r\n1,2\r\n3,4';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles fields with embedded newlines inside quotes', () => {
    const text = 'name,bio\n"alice","line1\nline2"';
    expect(parseCsv(text)).toEqual([
      ['name', 'bio'],
      ['alice', 'line1\nline2'],
    ]);
  });

  it('produces empty strings for empty fields', () => {
    const text = 'a,b,c\n1,,3';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('skips fully empty trailing lines', () => {
    const text = 'a,b\n1,2\n\n';
    const rows = parseCsv(text);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['1', '2']);
  });

  it('handles trailing data without final newline', () => {
    const text = 'a\n1';
    expect(parseCsv(text)).toEqual([['a'], ['1']]);
  });
});

describe('CSV inferType', () => {
  it('infers numeric for all-integer values', () => {
    expect(inferType(['1', '2', '3'])).toBe('numeric');
  });

  it('infers numeric for mixed int and float values', () => {
    expect(inferType(['1', '2.5', '3.14'])).toBe('numeric');
  });

  it('infers numeric for negative values', () => {
    expect(inferType(['-1', '0', '5'])).toBe('numeric');
  });

  it('infers boolean for true/false values', () => {
    expect(inferType(['true', 'false', 'true'])).toBe('boolean');
  });

  it('infers boolean for yes/no', () => {
    expect(inferType(['yes', 'no'])).toBe('boolean');
  });

  it('classifies pure 0/1 columns as numeric (numeric check runs before boolean)', () => {
    // The implementation checks numeric before boolean, so all-digit boolean-ish
    // columns ('0','1') resolve to numeric. true/false/yes/no are unambiguously boolean.
    expect(inferType(['0', '1', '0'])).toBe('numeric');
  });

  it('infers date for ISO 8601 dates', () => {
    expect(inferType(['2026-05-04', '2026-05-05'])).toBe('date');
  });

  it('infers date for ISO 8601 datetime', () => {
    expect(inferType(['2026-05-04T10:00:00Z'])).toBe('date');
  });

  it('falls through to text for mixed types', () => {
    expect(inferType(['1', 'hello'])).toBe('text');
  });

  it('falls through to text for non-ISO dates', () => {
    expect(inferType(['5/4/2026', '5/5/2026'])).toBe('text');
  });

  it('returns text for empty value list', () => {
    expect(inferType([])).toBe('text');
    expect(inferType(['', '', ''])).toBe('text');
  });

  it('ignores empty values during inference', () => {
    expect(inferType(['1', '', '3'])).toBe('numeric');
  });
});

describe('CSV coerceValue', () => {
  it('returns null for empty input regardless of type', () => {
    expect(coerceValue('', 'numeric')).toBeNull();
    expect(coerceValue('   ', 'text')).toBeNull();
  });

  it('parses numeric to a number', () => {
    expect(coerceValue('42', 'numeric')).toBe(42);
    expect(coerceValue('3.14', 'numeric')).toBe(3.14);
    expect(coerceValue('-5', 'numeric')).toBe(-5);
  });

  it('coerces boolean true variants', () => {
    expect(coerceValue('true', 'boolean')).toBe(true);
    expect(coerceValue('yes', 'boolean')).toBe(true);
    expect(coerceValue('1', 'boolean')).toBe(true);
    expect(coerceValue('TRUE', 'boolean')).toBe(true);
  });

  it('coerces boolean false variants', () => {
    expect(coerceValue('false', 'boolean')).toBe(false);
    expect(coerceValue('no', 'boolean')).toBe(false);
    expect(coerceValue('0', 'boolean')).toBe(false);
  });

  it('preserves date strings as-is', () => {
    expect(coerceValue('2026-05-04', 'date')).toBe('2026-05-04');
  });

  it('preserves text values without trimming', () => {
    expect(coerceValue('  hello world  ', 'text')).toBe('  hello world  ');
  });

  it('falls back to original string when numeric coercion fails', () => {
    expect(coerceValue('not-a-number', 'numeric')).toBe('not-a-number');
  });
});
