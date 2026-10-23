#!/usr/bin/env node
/**
 * preview.js — Instant zero-database frontend preview server
 *
 * Serves static files from client/public and includes mock API endpoints
 * so you can view and interact with all frontend pages immediately
 * without needing a database running.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'client', 'public');
const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Mock data for previewing all frontend screens
const MOCK_STATE = {
  user: {
    id: '00000000-0000-0000-0002-000000000001',
    email: 'synth.student1@almatrace.local',
    role: 'student',
    status: 'active',
  },
  profile: {
    display_name: 'Arjun Dev',
    headline: 'MCA Student (2024–2026 Batch)',
    bio: 'Interested in distributed systems, compilers, and cloud engineering.',
    current_role: 'Student',
    current_company: 'PSG College of Technology',
    time_zone: 'Asia/Kolkata',
    visibility: 'discoverable',
  },
  memberships: [
    {
      id: 'mem-1',
      member_type: 'student',
      normalized_token_key: 'S24001',
      affiliation_status: 'verified',
      is_primary: true,
      admission_year: 2024,
      graduation_year: 2026,
      cohort_label: '2024–2026 MCA',
      program_name: 'Master of Computer Applications',
      department_name: 'Department of MCA',
      department_code: 'MCA',
    },
  ],
  departments: [
    {
      id: 'dept-1',
      name: 'Department of MCA',
      code: 'MCA',
      institution: 'PSG College of Technology',
      programs: [
        {
          id: 'prog-1',
          name: 'Master of Computer Applications',
          degree: 'M.C.A.',
          duration_years: 2,
          cohorts: [
            { id: 'c-2024', admission_year: 2024, graduation_year: 2026, label: '2024–2026 MCA', enrollment_open: true },
            { id: 'c-2021', admission_year: 2021, graduation_year: 2023, label: '2021–2023 MCA (Alumni)', enrollment_open: true },
            { id: 'c-2018', admission_year: 2018, graduation_year: 2020, label: '2018–2020 MCA (Alumni)', enrollment_open: true },
          ],
        },
      ],
    },
  ],
  tokenLineage: {
    department: 'MCA',
    canonicalTokenKey: 'S24001',
    ruleMode: 'synthetic',
    timeline: [
      {
        cohortId: 'c-2024',
        cohortLabel: '2024–2026 MCA',
        admissionYear: 2024,
        graduationYear: 2026,
        state: 'self',
        tokenKey: 'S24001',
        details: 'Your enrolled batch membership',
      },
      {
        cohortId: 'c-2021',
        cohortLabel: '2021–2023 MCA',
        admissionYear: 2021,
        graduationYear: 2023,
        state: 'active',
        tokenKey: 'A21001',
        counterpart: {
          userId: 'user-alumni-1',
          displayName: 'Meena Suresh',
          headline: 'Senior Cloud Architect @ AWS • PSG MCA 2023',
          currentRole: 'Senior Cloud Architect',
          currentCompany: 'Amazon Web Services',
          acceptingRequests: true,
        },
      },
      {
        cohortId: 'c-2018',
        cohortLabel: '2018–2020 MCA',
        admissionYear: 2018,
        graduationYear: 2020,
        state: 'unregistered',
        tokenKey: 'A18001',
        details: 'No alumni registered for this token key yet.',
      },
    ],
  },
  recommendations: [
    {
      mentor: {
        userId: 'user-alumni-1',
        displayName: 'Meena Suresh',
        headline: 'Senior Cloud Architect @ AWS • PSG MCA 2023',
        currentRole: 'Senior Cloud Architect',
        currentCompany: 'Amazon Web Services',
        preferredModes: 'online',
        scheduleNote: 'Available Saturday mornings (IST)',
        availableSlots: 2,
      },
      score: 0.95,
      explanation: 'Primary token lineage counterpart (Sequence 001). Shared guidance topics: Cloud Computing, Systems Design.',
    },
    {
      mentor: {
        userId: 'user-alumni-2',
        displayName: 'Rajan Pillai',
        headline: 'Staff Software Engineer @ Thoughtworks',
        currentRole: 'Staff Software Engineer',
        currentCompany: 'Thoughtworks',
        preferredModes: 'either',
        scheduleNote: 'Weekends & weekday evenings',
        availableSlots: 3,
      },
      score: 0.88,
      explanation: 'Shared topics: Software Development, Career Planning. Has 3 available mentorship slots.',
    },
    {
      mentor: {
        userId: 'user-alumni-3',
        displayName: 'Sowmya Nair',
        headline: 'AI/ML Research Scientist @ Google DeepMind',
        currentRole: 'Research Scientist',
        currentCompany: 'Google DeepMind',
        preferredModes: 'online',
        scheduleNote: 'Bi-weekly Sunday calls',
        availableSlots: 1,
      },
      score: 0.82,
      explanation: 'Topic overlap: Machine Learning & AI, Higher Education & Research. Convenient online mode.',
    },
  ],
  requests: {
    incoming: [
      {
        id: 'req-in-1',
        mentee_id: 'user-student-2',
        mentee_name: 'Priya Kannan',
        status: 'sent',
        purpose: 'Guidance on Preparation for Tech Interviews and Systems Design',
        message: 'Hi! I would appreciate your advice on transitioning to distributed systems roles.',
        created_at: new Date().toISOString(),
      },
    ],
    outgoing: [
      {
        id: 'req-out-1',
        mentor_id: 'user-alumni-1',
        mentor_name: 'Meena Suresh',
        status: 'accepted',
        purpose: 'Cloud Architecture & Microservices Discussion',
        created_at: new Date().toISOString(),
      },
    ],
  },
  verifications: [
    {
      id: 'v-1',
      display_name: 'Anand Kumar',
      email: 'anand.k@alumni.psgtech.ac.in',
      member_type: 'alumni',
      cohort_label: '2021–2023 MCA',
      raw_identifier: '21MX004',
      normalized_token_key: 'A21004',
      affiliation_status: 'pending',
    },
    {
      id: 'v-2',
      display_name: 'Deepa Murali',
      email: 'deepa.m@psgtech.ac.in',
      member_type: 'student',
      cohort_label: '2024–2026 MCA',
      raw_identifier: '24MX004',
      normalized_token_key: 'S24004',
      affiliation_status: 'pending',
    },
  ],
  metrics: {
    users: [
      { role: 'student', status: 'active', count: 42 },
      { role: 'alumni', status: 'active', count: 28 },
      { role: 'alumni', status: 'pending_review', count: '< 5' },
    ],
    mentorships: [
      { status: 'active', count: 24 },
      { status: 'completed', count: 18 },
      { status: 'paused', count: '< 5' },
    ],
    requests: [
      { status: 'accepted', count: 32 },
      { status: 'sent', count: 6 },
      { status: 'declined', count: '< 5' },
    ],
  },
  auditEvents: [
    { id: 104, action: 'MEMBERSHIP_VERIFIED', actor_email: 'coordinator@psgtech.ac.in', target_type: 'membership', target_id: 'v-1', created_at: new Date().toISOString() },
    { id: 103, action: 'MENTORSHIP_ACCEPTED', actor_email: 'meena.s@alumni.psgtech.ac.in', target_type: 'mentorship', target_id: 'm-201', created_at: new Date(Date.now() - 3600000).toISOString() },
    { id: 102, action: 'USER_REGISTERED', actor_email: 'synth.student1@almatrace.local', target_type: 'user', target_id: 'u-1', created_at: new Date(Date.now() - 7200000).toISOString() },
  ],
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ── Mock API Router ───────────────────────────────────────────────────────
  if (pathname.startsWith('/api/v1/')) {
    res.setHeader('Content-Type', 'application/json');

    if (pathname === '/api/v1/health') {
      return res.end(JSON.stringify({ status: 'ok', app: 'ALMATRACE', env: 'preview', synthetic: true }));
    }
    if (pathname === '/api/v1/auth/session') {
      return res.end(JSON.stringify({ authenticated: true, user: MOCK_STATE.user }));
    }
    if (pathname === '/api/v1/auth/login') {
      return res.end(JSON.stringify({ message: 'Signed in successfully.', user: MOCK_STATE.user }));
    }
    if (pathname === '/api/v1/auth/logout') {
      return res.end(JSON.stringify({ message: 'Signed out.' }));
    }
    if (pathname === '/api/v1/auth/register') {
      return res.end(JSON.stringify({ message: 'Registered.', devVerificationToken: 'mock_token_123' }));
    }
    if (pathname === '/api/v1/auth/verify-email') {
      return res.end(JSON.stringify({ verified: true, message: 'Verified.' }));
    }
    if (pathname === '/api/v1/departments') {
      return res.end(JSON.stringify({ departments: MOCK_STATE.departments }));
    }
    if (pathname === '/api/v1/me') {
      return res.end(JSON.stringify({
        user: MOCK_STATE.user,
        profile: MOCK_STATE.profile,
        memberships: MOCK_STATE.memberships,
        mentorSettings: null,
      }));
    }
    if (pathname === '/api/v1/me/token-lineage') {
      return res.end(JSON.stringify({ tokenLineage: MOCK_STATE.tokenLineage }));
    }
    if (pathname === '/api/v1/mentors/recommendations') {
      return res.end(JSON.stringify({ recommendations: MOCK_STATE.recommendations }));
    }
    if (pathname === '/api/v1/mentorship/requests') {
      return res.end(JSON.stringify(MOCK_STATE.requests));
    }
    if (pathname.startsWith('/api/v1/mentorship/requests/') && req.method === 'PATCH') {
      return res.end(JSON.stringify({ message: 'Request updated.' }));
    }
    if (pathname === '/api/v1/admin/verifications') {
      return res.end(JSON.stringify({ verifications: MOCK_STATE.verifications }));
    }
    if (pathname.startsWith('/api/v1/admin/verifications/') && req.method === 'POST') {
      return res.end(JSON.stringify({ message: 'Decision recorded.' }));
    }
    if (pathname === '/api/v1/admin/metrics') {
      return res.end(JSON.stringify(MOCK_STATE.metrics));
    }
    if (pathname === '/api/v1/admin/audit-logs') {
      return res.end(JSON.stringify({ auditEvents: MOCK_STATE.auditEvents }));
    }
    if (pathname === '/api/v1/admin/reports') {
      return res.end(JSON.stringify({ reports: [] }));
    }

    return res.end(JSON.stringify({ status: 'mock_ok' }));
  }

  // ── Static Files Router ───────────────────────────────────────────────────
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<h1>404 Not Found</h1><p><a href="/">Return to Home</a></p>`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 ALMATRACE FRONTEND PREVIEW SERVER RUNNING!`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`======================================================\n`);
  console.log(`Explore these ready screens:`);
  console.log(`  • Home / Overview:     http://localhost:${PORT}/index.html`);
  console.log(`  • Sign In:             http://localhost:${PORT}/login.html`);
  console.log(`  • Register Wizard:     http://localhost:${PORT}/register.html`);
  console.log(`  • Member Dashboard:    http://localhost:${PORT}/dashboard.html`);
  console.log(`  • Token Lineage:       http://localhost:${PORT}/lineage.html`);
  console.log(`  • Find Mentors:        http://localhost:${PORT}/mentors.html`);
  console.log(`  • Requests Workspace:  http://localhost:${PORT}/requests.html`);
  console.log(`  • Coordinator Console: http://localhost:${PORT}/admin.html`);
  console.log(`  • Privacy Notice:      http://localhost:${PORT}/privacy.html`);
  console.log(`  • Code of Conduct:     http://localhost:${PORT}/conduct.html`);
  console.log(`\nPress Ctrl+C to stop.\n`);
});
