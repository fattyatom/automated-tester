import { defineQaConfig } from './src/config';

/**
 * Point this at your environment and your vault. Everything else is inferred from the notes.
 * Defaults target the bundled demo app + example vault so `npm test` works out of the box.
 */
export default defineQaConfig({
  baseURL: process.env.QA_BASE_URL ?? 'http://localhost:4321',
  vault: process.env.QA_VAULT ?? './examples/vault',
  overlays: ['.qa/overlay'],

  personas: {
    customer: {
      username: process.env.QA_CUSTOMER_USER ?? 'user@example.com',
      password: process.env.QA_CUSTOMER_PASS ?? 'Passw0rd!',
      roles: ['customer'],
    },
    admin: {
      username: process.env.QA_ADMIN_USER ?? 'admin@example.com',
      password: process.env.QA_ADMIN_PASS ?? 'Admin123!',
      roles: ['admin'],
    },
  },

  auth: {
    loginRoute: '/login',
    usernameField: 'Email',
    passwordField: 'Password',
    submit: 'Sign in',
    // login: async (page, persona) => { ...SSO / MFA / API-token login... },
  },

  // Project-specific steps go here (the qa-step-author agent adds to this list).
  steps: [],

  explore: {
    failOn: 'high',
  },

  report: {
    outputDir: 'qa-report',
    // writeToVault: './examples/vault/_QA',
  },
});
