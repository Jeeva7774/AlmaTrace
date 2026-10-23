/**
 * tokenRuleEngine.js — configurable token parsing and lineage matching engine
 *
 * Implements the rule interface and parser test harness.
 * As D1 is UNCONFIRMED, rules are explicitly marked 'synthetic' or 'configurable'.
 * Synthetic output is clearly flagged as unverified for production.
 */

export class TokenParserError extends Error {
  constructor(message, code = 'INVALID_FORMAT') {
    super(message);
    this.name = 'TokenParserError';
    this.code = code;
  }
}

/**
 * Normalizes a raw roll number / token identifier based on the rule configuration.
 * Handles whitespace, letter casing, separators, and leading zeros.
 *
 * Supported rule types:
 * - 'synthetic': preserves alphanumeric core, strips whitespace, uppercases.
 * - 'suffix_digits': extracts trailing numeric digits, preserves leading zeros if configured.
 * - 'pattern_regex': uses a named regex group (?<sequence>[0-9A-Z]+).
 */
export function normalizeIdentifier(rawIdentifier, ruleConfig = {}) {
  if (!rawIdentifier || typeof rawIdentifier !== 'string') {
    throw new TokenParserError('Identifier must be a non-empty string.', 'EMPTY_IDENTIFIER');
  }

  const cleaned = rawIdentifier.trim();
  if (cleaned.length === 0) {
    throw new TokenParserError('Identifier cannot be empty or pure whitespace.', 'EMPTY_IDENTIFIER');
  }

  const ruleType = ruleConfig.type || 'synthetic';

  if (ruleType === 'synthetic') {
    // Alphanumeric normalization
    const normalized = cleaned.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (normalized.length === 0) {
      throw new TokenParserError('Identifier contains no alphanumeric characters.', 'INVALID_FORMAT');
    }
    return normalized;
  }

  if (ruleType === 'suffix_digits') {
    // e.g., '24MX012' -> extracts '012' or '12' depending on preserveLeadingZeros
    const match = cleaned.match(/(\d+)$/);
    if (!match) {
      throw new TokenParserError('Identifier does not end with numeric digits.', 'MISSING_NUMERIC_SUFFIX');
    }
    let digits = match[1];
    if (!ruleConfig.preserveLeadingZeros) {
      digits = String(parseInt(digits, 10));
    }
    return digits;
  }

  if (ruleType === 'pattern_regex' && ruleConfig.regex) {
    const rx = new RegExp(ruleConfig.regex, 'i');
    const match = cleaned.match(rx);
    if (!match) {
      throw new TokenParserError(`Identifier does not match pattern: ${ruleConfig.regex}`, 'PATTERN_MISMATCH');
    }
    const token = match.groups?.sequence || match[1] || match[0];
    return token.toUpperCase();
  }

  // Fallback: uppercase trimmed string
  return cleaned.toUpperCase();
}

/**
 * Derives the canonical cross-cohort token key.
 *
 * @param {string} departmentCode e.g. 'MCA'
 * @param {string} normalizedSeq  e.g. '012' or 'S24001'
 * @returns {string} Canonical key e.g. 'MCA::012'
 */
export function deriveCanonicalTokenKey(departmentCode, normalizedSeq) {
  return `${departmentCode.trim().toUpperCase()}::${normalizedSeq.trim().toUpperCase()}`;
}

/**
 * Explainable match rationale.
 */
export function explainTokenRelationship(sourceMembership, targetMembership, ruleVersion) {
  return {
    sourceTokenKey: sourceMembership.normalized_token_key,
    targetTokenKey: targetMembership.normalized_token_key,
    matched: sourceMembership.normalized_token_key === targetMembership.normalized_token_key,
    ruleVersion: ruleVersion || 'synthetic-v1',
    isSynthetic: true, // Pending D1 confirmation
    confidence: sourceMembership.normalized_token_key === targetMembership.normalized_token_key ? 1.0 : 0.0,
    rationale: `Matched based on canonical department sequence key (${sourceMembership.normalized_token_key}). Historical lineage suggested; active mentorship requires explicit reciprocal consent.`,
  };
}
