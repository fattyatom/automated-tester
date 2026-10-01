import fs from 'node:fs';
import { defineQaConfig } from './src/config';

/**
 * Which vault to test:
 *   1. QA_VAULT env var, if set
 *   2. ./vault — your product's knowledge base — once it has a credentials.md
 *   3. ./examples/vault — the bundled demo (ShopLite)
 *
 * Target URL, login form and personas come from the vault's credentials.md (git-ignored, like
 * .env; see vault/sample.credentials.md). QA_BASE_URL overrides the URL for one-off runs.
 */
const vault = process.env.QA_VAULT ?? (fs.existsSync('./vault/credentials.md') ? './vault' : './examples/vault');

export default defineQaConfig({
  baseURL: 'http://localhost:4321',
  vault,
  overlays: ['.qa/overlay'],

  auth: {
    // Everything else (route, field labels, submit button) comes from credentials.md.
    // For SSO / MFA / API-token logins, replace the form login entirely:
    // login: async (page, persona, config) => { ... },
  },

  // Project-specific steps go here (the qa-step-author agent adds to this list).
  steps: [],

  explore: {
    failOn: 'high',
  },

  report: {
    outputDir: 'qa-report',
    // writeToVault: `${vault}/_QA Runs`,
  },
});
