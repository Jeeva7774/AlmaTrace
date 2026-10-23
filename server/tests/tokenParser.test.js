/**
 * tokenParser.test.js — test harness for token normalization and matching rules
 *
 * Covers synthetic formats, leading zeros, spaces, case insensitivity,
 * pattern matching, and error cases (per D1 hard stop requirements).
 */

import {
  normalizeIdentifier,
  deriveCanonicalTokenKey,
  explainTokenRelationship,
  TokenParserError,
} from '../src/modules/matching/tokenRuleEngine.js';

describe('tokenRuleEngine — normalizeIdentifier', () => {
  describe('synthetic rule type', () => {
    test('normalizes standard uppercase alphanumeric roll numbers', () => {
      expect(normalizeIdentifier('24MX001', { type: 'synthetic' })).toBe('24MX001');
    });

    test('trims leading and trailing whitespace', () => {
      expect(normalizeIdentifier('   24MX001   ', { type: 'synthetic' })).toBe('24MX001');
    });

    test('converts lowercase characters to uppercase', () => {
      expect(normalizeIdentifier('24mx015', { type: 'synthetic' })).toBe('24MX015');
    });

    test('strips punctuation/hyphen separators in synthetic mode', () => {
      expect(normalizeIdentifier('24-MX-001', { type: 'synthetic' })).toBe('24MX001');
    });

    test('throws TokenParserError on empty or pure whitespace input', () => {
      expect(() => normalizeIdentifier('', { type: 'synthetic' })).toThrow(TokenParserError);
      expect(() => normalizeIdentifier('   ', { type: 'synthetic' })).toThrow(TokenParserError);
    });

    test('throws TokenParserError on null or non-string input', () => {
      expect(() => normalizeIdentifier(null, { type: 'synthetic' })).toThrow(TokenParserError);
      expect(() => normalizeIdentifier(undefined, { type: 'synthetic' })).toThrow(TokenParserError);
      expect(() => normalizeIdentifier(12345, { type: 'synthetic' })).toThrow(TokenParserError);
    });

    test('throws TokenParserError when string has no alphanumeric characters', () => {
      expect(() => normalizeIdentifier('---///', { type: 'synthetic' })).toThrow(TokenParserError);
    });
  });

  describe('suffix_digits rule type', () => {
    test('extracts numeric suffix while preserving leading zeros when configured', () => {
      const res = normalizeIdentifier('24MX007', { type: 'suffix_digits', preserveLeadingZeros: true });
      expect(res).toBe('007');
    });

    test('extracts numeric suffix and strips leading zeros when not preserving', () => {
      const res = normalizeIdentifier('24MX007', { type: 'suffix_digits', preserveLeadingZeros: false });
      expect(res).toBe('7');
    });

    test('throws TokenParserError when no digits exist at the end', () => {
      expect(() => normalizeIdentifier('24MXABC', { type: 'suffix_digits' })).toThrow(TokenParserError);
    });
  });

  describe('pattern_regex rule type', () => {
    test('extracts named sequence group', () => {
      const config = { type: 'pattern_regex', regex: '^[0-9]{2}MX(?<sequence>[0-9]{3})$' };
      expect(normalizeIdentifier('24MX042', config)).toBe('042');
    });

    test('throws pattern mismatch error on invalid roll format', () => {
      const config = { type: 'pattern_regex', regex: '^[0-9]{2}MX(?<sequence>[0-9]{3})$' };
      expect(() => normalizeIdentifier('INVALID_FORMAT', config)).toThrow(TokenParserError);
    });
  });
});

describe('tokenRuleEngine — deriveCanonicalTokenKey', () => {
  test('creates scoped canonical token key', () => {
    expect(deriveCanonicalTokenKey('MCA', '001')).toBe('MCA::001');
    expect(deriveCanonicalTokenKey('mca ', ' 24mx001 ')).toBe('MCA::24MX001');
  });
});

describe('tokenRuleEngine — explainTokenRelationship', () => {
  test('generates explainable match rationale', () => {
    const source = { normalized_token_key: 'S24001' };
    const target = { normalized_token_key: 'S24001' };

    const explanation = explainTokenRelationship(source, target, 'synthetic-v1');
    expect(explanation.matched).toBe(true);
    expect(explanation.confidence).toBe(1.0);
    expect(explanation.isSynthetic).toBe(true);
    expect(explanation.rationale).toContain('Historical lineage suggested');
  });

  test('generates non-match rationale when keys differ', () => {
    const source = { normalized_token_key: 'S24001' };
    const target = { normalized_token_key: 'S24002' };

    const explanation = explainTokenRelationship(source, target, 'synthetic-v1');
    expect(explanation.matched).toBe(false);
    expect(explanation.confidence).toBe(0.0);
  });
});
