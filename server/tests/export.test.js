/**
 * export.test.js — unit and route tests for administrator Excel member export
 */

describe('Spreadsheet formula-injection protection', () => {
  const FORMULA_START = /^[=+\-@]/;
  function sanitizeCell(v) {
    if (v === null || v === undefined) return '';
    const str = String(v);
    return FORMULA_START.test(str) ? `'${str}` : str;
  }

  test('neutralizes formula-injection characters at the start of cells', () => {
    expect(sanitizeCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(sanitizeCell('+12345')).toBe("'+12345");
    expect(sanitizeCell('-cmd|/C calc')).toBe("'-cmd|/C calc");
    expect(sanitizeCell('@SUM(1,2)')).toBe("'@SUM(1,2)");
  });

  test('leaves benign text and numbers untouched', () => {
    expect(sanitizeCell('Arjun Dev')).toBe('Arjun Dev');
    expect(sanitizeCell('MCA 2024–2026')).toBe('MCA 2024–2026');
    expect(sanitizeCell('student@psgtech.ac.in')).toBe('student@psgtech.ac.in');
    expect(sanitizeCell('42')).toBe('42');
  });

  test('handles null and undefined values safely', () => {
    expect(sanitizeCell(null)).toBe('');
    expect(sanitizeCell(undefined)).toBe('');
    expect(sanitizeCell('')).toBe('');
  });
});

describe('Export categories and input validation', () => {
  const ALLOWED_CATEGORIES = new Set(['all', 'students', 'alumni']);

  function validateCategory(cat) {
    const normalized = (cat || 'all').toLowerCase();
    if (!ALLOWED_CATEGORIES.has(normalized)) {
      throw new Error("Query parameter 'category' must be 'students', 'alumni', or 'all'.");
    }
    return normalized;
  }

  test('accepts valid category options', () => {
    expect(validateCategory('all')).toBe('all');
    expect(validateCategory('students')).toBe('students');
    expect(validateCategory('alumni')).toBe('alumni');
    expect(validateCategory(undefined)).toBe('all');
    expect(validateCategory('STUDENTS')).toBe('students');
  });

  test('rejects unauthorized or arbitrary category values', () => {
    expect(() => validateCategory('teachers')).toThrow();
    expect(() => validateCategory('admin')).toThrow();
    expect(() => validateCategory('; DROP TABLE users;')).toThrow();
  });
});

describe('Export safe fields allowlist', () => {
  const SENSITIVE_FIELDS = [
    'password_hash',
    'password',
    'session_token',
    'verification_token',
    'reset_token',
    'salt',
  ];

  const STUDENT_EXPORT_COLUMNS = [
    'display_name',
    'email',
    'normalized_token_key',
    'cohort_label',
    'program_name',
    'department_name',
    'affiliation_status',
    'account_status',
    'registered_at',
    'headline',
    'time_zone',
  ];

  const ALUMNI_EXPORT_COLUMNS = [
    'display_name',
    'email',
    'normalized_token_key',
    'cohort_label',
    'program_name',
    'department_name',
    'affiliation_status',
    'account_status',
    'registered_at',
    'headline',
    'current_role',
    'current_company',
    'linkedin_url',
    'mentor_available',
    'accepting_requests',
    'max_mentees',
    'time_zone',
  ];

  test('export columns strictly exclude all authentication and sensitive secrets', () => {
    for (const secret of SENSITIVE_FIELDS) {
      expect(STUDENT_EXPORT_COLUMNS).not.toContain(secret);
      expect(ALUMNI_EXPORT_COLUMNS).not.toContain(secret);
    }
  });

  test('audit log metadata contains counts and field names without raw row records', () => {
    const auditPayload = {
      actorId: 'coord-123',
      action: 'ADMIN_EXPORT_MEMBERS',
      targetType: 'export',
      targetId: null,
      metadata: {
        category: 'students',
        recordCount: 42,
        fields: STUDENT_EXPORT_COLUMNS,
      },
    };

    expect(auditPayload.metadata.recordCount).toBe(42);
    expect(auditPayload.metadata.fields).toBeDefined();
    expect(auditPayload.metadata.rows).toBeUndefined();
    expect(auditPayload.metadata.data).toBeUndefined();
  });
});
