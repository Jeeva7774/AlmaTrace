/**
 * app.js — client-side entry point
 *
 * Bootstraps the client application. In this early stage it:
 *   - Hides the synthetic data banner if SYNTHETIC_DATA_BANNER is false
 *     (checked via API, not client-side env vars — never trust client)
 *   - Will later handle client-side routing for an SPA-style experience
 *
 * Uses ES modules (type="module" in <script> tag).
 * No external dependencies — vanilla JS only.
 */

import { ApiClient } from './services/api.js';

const api = new ApiClient('/api/v1');

async function init() {
  try {
    const health = await api.get('/health');
    if (!health.synthetic) {
      const banner = document.querySelector('.env-banner');
      if (banner) banner.remove();
    }
  } catch {
    // Server may not be up during static file preview — ignore
  }
}

init();
