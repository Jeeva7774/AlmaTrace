/**
 * departmentRoutes.js — department, program, cohort management, and CSV import preview
 */

import { Router } from 'express';
import { query, withTransaction } from '../../config/db.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createError } from '../../middleware/errorHandler.js';

const router = Router();

// ── GET /api/v1/departments — list active departments & cohorts for onboarding ──
router.get('/', async (_req, res, next) => {
  try {
    const depts = await query(
      `SELECT d.id, d.name, d.code, d.institution
       FROM departments d
       WHERE d.active = TRUE
       ORDER BY d.name`
    );

    const programs = await query(
      `SELECT p.id, p.department_id, p.name, p.degree, p.duration_years
       FROM programs p
       WHERE p.active = TRUE
       ORDER BY p.name`
    );

    const cohorts = await query(
      `SELECT c.id, c.program_id, c.admission_year, c.graduation_year, c.label, c.cohort_type, c.enrollment_open
       FROM cohorts c
       WHERE c.eligible_for_matching = TRUE
       ORDER BY c.admission_year DESC`
    );

    const programMap = {};
    for (const p of programs.rows) {
      p.cohorts = cohorts.rows.filter((c) => c.program_id === p.id);
      if (!programMap[p.department_id]) programMap[p.department_id] = [];
      programMap[p.department_id].push(p);
    }

    const result = depts.rows.map((d) => ({
      ...d,
      programs: programMap[d.id] || [],
    }));

    res.json({ departments: result });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/departments — add department (coordinator only) ─────────
router.post('/', requireAuth, requireRole('coordinator', 'sysadmin'), async (req, res, next) => {
  try {
    const { name, code, institution = 'PSG College of Technology' } = req.body;
    if (!name || !code) {
      throw createError(400, 'VALIDATION_ERROR', 'Department name and code are required.');
    }

    const result = await query(
      `INSERT INTO departments (name, code, institution)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name.trim(), code.trim().toUpperCase(), institution.trim()]
    );

    res.status(201).json({ department: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/departments/:id/programs — add program (coordinator only) ─
router.post('/:id/programs', requireAuth, requireRole('coordinator', 'sysadmin'), async (req, res, next) => {
  try {
    const { name, degree = 'M.C.A.', durationYears = 2 } = req.body;
    if (!name) {
      throw createError(400, 'VALIDATION_ERROR', 'Program name is required.');
    }

    const result = await query(
      `INSERT INTO programs (department_id, name, degree, duration_years)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, name.trim(), degree.trim(), durationYears]
    );

    res.status(201).json({ program: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/programs/:id/cohorts — add cohort (coordinator only) ─────
router.post('/programs/:id/cohorts', requireAuth, requireRole('coordinator', 'sysadmin'), async (req, res, next) => {
  try {
    const { admissionYear, graduationYear, label, cohortType = 'regular' } = req.body;
    if (!admissionYear || !graduationYear || !label) {
      throw createError(400, 'VALIDATION_ERROR', 'admissionYear, graduationYear, and label are required.');
    }

    const result = await query(
      `INSERT INTO cohorts (program_id, admission_year, graduation_year, label, cohort_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, Number(admissionYear), Number(graduationYear), label.trim(), cohortType]
    );

    res.status(201).json({ cohort: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/departments/imports/dry-run — CSV import dry-run preview ──
router.post('/imports/dry-run', requireAuth, requireRole('coordinator', 'sysadmin'), async (req, res, next) => {
  try {
    const { rows, cohortId, memberType } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      throw createError(400, 'EMPTY_IMPORT', 'CSV rows must be provided as an array.');
    }

    const validatedRows = [];
    const errors = [];
    const seenIdentifiers = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowErrors = [];

      if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
        rowErrors.push({ field: 'email', message: 'Valid email is required.' });
      }
      if (!row.displayName || row.displayName.trim().length < 2) {
        rowErrors.push({ field: 'displayName', message: 'Display name must be at least 2 characters.' });
      }
      if (!row.identifier || row.identifier.trim().length === 0) {
        rowErrors.push({ field: 'identifier', message: 'Roll number or token identifier is required.' });
      } else {
        const canonical = row.identifier.trim().toUpperCase();
        if (seenIdentifiers.has(canonical)) {
          rowErrors.push({ field: 'identifier', message: 'Duplicate identifier in this import batch.' });
        }
        seenIdentifiers.add(canonical);
      }

      const isValid = rowErrors.length === 0;
      validatedRows.push({
        rowNumber: i + 1,
        data: row,
        status: isValid ? 'valid' : 'invalid',
        errors: rowErrors,
      });

      if (!isValid) errors.push({ rowNumber: i + 1, errors: rowErrors });
    }

    res.json({
      summary: {
        totalRows: rows.length,
        validCount: validatedRows.filter((r) => r.status === 'valid').length,
        errorCount: errors.length,
        dryRunOnly: true,
      },
      previewRows: validatedRows.slice(0, 50),
      errors,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
