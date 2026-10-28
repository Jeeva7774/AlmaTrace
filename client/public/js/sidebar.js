/**
 * sidebar.js — ALMATRACE Sidebar Shell
 * ES Module: import { initSidebar, renderSidebar } from './sidebar.js';
 */

/* ── Role display labels ─────────────────────────────────────────────────── */
const ROLE_LABELS = {
  student:     'Student',
  alumni:      'Alumni',
  coordinator: 'Coordinator',
  sysadmin:    'System Admin',
};

/* ── initSidebar(userRole) ───────────────────────────────────────────────── */

/**
 * Initialise the sidebar shell for the current page.
 *
 * @param {string} userRole - One of 'student' | 'alumni' | 'coordinator' | 'sysadmin'
 */
export function initSidebar(userRole) {
  _markActiveLink();
  _filterLinksByRole(userRole);
  _wireMenuToggle();
  _wireLogout();
  _wireNavLinkClose();
}

/* ── renderSidebar(userInfo) ─────────────────────────────────────────────── */

/**
 * Populate the user area at the bottom of the sidebar.
 *
 * @param {{ displayName?: string, email?: string, role?: string }} userInfo
 */
export function renderSidebar(userInfo = {}) {
  const nameEl   = document.querySelector('.sidebar__user-name');
  const roleEl   = document.querySelector('.sidebar__user-role');
  const avatarEl = document.querySelector('.sidebar__user-avatar');

  const displayName = userInfo.displayName || userInfo.email || 'Member';
  const roleLabel   = ROLE_LABELS[userInfo.role] || userInfo.role || 'User';
  const initial     = displayName.trim()[0]?.toUpperCase() ?? '?';

  if (nameEl)   nameEl.textContent   = displayName;
  if (roleEl)   roleEl.textContent   = roleLabel;
  if (avatarEl) avatarEl.textContent = initial;
}

/* ── Private helpers ─────────────────────────────────────────────────────── */

/**
 * Mark the sidebar link whose href matches the current pathname as active.
 * Falls back to base-name matching so `/lineage.html` matches `/app/lineage.html`.
 */
function _markActiveLink() {
  const links    = document.querySelectorAll('.sidebar__link');
  const pathname = window.location.pathname;

  links.forEach((link) => {
    link.classList.remove('active');
    link.removeAttribute('aria-current');
  });

  // Try exact pathname first, then basename
  const matched = _findBestMatch(links, pathname);

  if (matched) {
    matched.classList.add('active');
    matched.setAttribute('aria-current', 'page');
  }
}

/**
 * Returns the link element whose href best matches the given pathname.
 * Prefers exact match; falls back to filename match.
 *
 * @param {NodeListOf<Element>} links
 * @param {string} pathname
 * @returns {Element|null}
 */
function _findBestMatch(links, pathname) {
  const normalise = (p) => p.replace(/\/+$/, '') || '/';
  const basename  = (p) => p.split('/').pop() || '';

  // 1. Exact normalised path match
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (normalise(href) === normalise(pathname)) return link;
  }

  // 2. Basename match (e.g., dashboard.html)
  const currentBase = basename(pathname);
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (basename(href) === currentBase && currentBase !== '') return link;
  }

  return null;
}

/**
 * Show only the links/sections that the given role is allowed to see.
 * Links carry `data-roles="role1,role2,..."` attributes.
 * Sections with `data-admin-only="true"` are hidden for non-admin roles.
 *
 * @param {string} userRole
 */
function _filterLinksByRole(userRole) {
  const role = (userRole || '').toLowerCase().trim();

  // Filter individual links
  const links = document.querySelectorAll('.sidebar__link[data-roles]');
  links.forEach((link) => {
    const allowed = (link.dataset.roles || '')
      .split(',')
      .map((r) => r.trim().toLowerCase());

    const visible = !role || allowed.includes(role);
    link.style.display = visible ? '' : 'none';
  });

  // Hide entire admin sections when role has no access
  const adminRoles = ['coordinator', 'sysadmin'];
  const isAdmin = adminRoles.includes(role);

  document.querySelectorAll('.sidebar__section[data-admin-only]').forEach((section) => {
    section.style.display = isAdmin ? '' : 'none';
  });

  // Hide section labels whose section has no visible links
  document.querySelectorAll('.sidebar__section').forEach((section) => {
    const visibleLinks = [...section.querySelectorAll('.sidebar__link')].filter(
      (l) => l.style.display !== 'none'
    );
    if (visibleLinks.length === 0) {
      section.style.display = 'none';
    }
  });
}

/**
 * Wire the mobile hamburger toggle and the overlay close button.
 */
function _wireMenuToggle() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.querySelector('.sidebar-overlay');
  const toggles  = document.querySelectorAll('.menu-toggle');

  if (!sidebar) return;

  function openSidebar() {
    sidebar.classList.add('sidebar--open');
    document.body.style.overflow = 'hidden';   // prevent background scroll
    if (overlay) overlay.classList.add('visible');
    // Set aria-expanded on all toggles
    toggles.forEach((btn) => btn.setAttribute('aria-expanded', 'true'));
    // Move focus into sidebar for keyboard users
    const firstFocusable = sidebar.querySelector('a, button, [tabindex="0"]');
    firstFocusable?.focus();
  }

  function closeSidebar() {
    sidebar.classList.remove('sidebar--open');
    document.body.style.overflow = '';
    if (overlay) overlay.classList.remove('visible');
    toggles.forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
  }

  toggles.forEach((btn) => {
    btn.setAttribute('aria-controls', 'sidebar');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
      const isOpen = sidebar.classList.contains('sidebar--open');
      isOpen ? closeSidebar() : openSidebar();
    });
  });

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('sidebar--open')) {
      closeSidebar();
      // Return focus to first toggle
      toggles[0]?.focus();
    }
  });

  // Expose closeSidebar globally so other helpers can call it
  sidebar._close = closeSidebar;
}

/**
 * Wire the sidebar logout button to POST /api/v1/auth/logout then redirect.
 */
function _wireLogout() {
  const btn = document.getElementById('sidebar-logout-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (_err) {
      // Network error — still redirect to clear client state
    } finally {
      window.location.href = '/login.html';
    }
  });
}

/**
 * On mobile, close the drawer after a nav link is clicked (page navigation).
 */
function _wireNavLinkClose() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.querySelectorAll('.sidebar__link').forEach((link) => {
    link.addEventListener('click', () => {
      // Only close if it's a real navigation (not just the current page)
      if (typeof sidebar._close === 'function') {
        sidebar._close();
      }
    });
  });
}
