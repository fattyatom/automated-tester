import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Scenario } from './model';

/**
 * `credentials.md` works like `.env`: `sample.credentials.md` is committed as a template, the real
 * `credentials.md` sits next to it in the vault and is git-ignored. Values may reference
 * environment variables as `${VAR}` or `${VAR:-default}` so CI can inject secrets.
 */
export const CREDENTIALS_FILE = 'credentials.md';
export const SAMPLE_CREDENTIALS_FILE = 'sample.credentials.md';

export interface CredentialPersona {
  username: string;
  password: string;
  roles: string[];
  /** Where this persona should land right after logging in. */
  landsOn?: string;
  /** Text that proves the login worked (e.g. "Welcome back"). */
  welcomeText?: string;
}

export interface CredentialsSpec {
  file: string;
  baseURL?: string;
  /** Where an anonymous visitor to baseURL should end up (e.g. "/" or "/login"). */
  landing?: string;
  login: {
    route: string;
    usernameField?: string;
    passwordField?: string;
    submit?: string;
    /** Message shown for a wrong password. */
    failureMessage?: string;
    /** Pages that must bounce anonymous visitors to the login page. */
    protectedRoutes: string[];
  };
  logout?: {
    route?: string;
    button?: string;
    /** Where the user should end up after logging out. */
    landsOn?: string;
  };
  personas: Record<string, CredentialPersona>;
}

const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function interpolate(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === 'string') return value.replace(ENV_REF, (_, name, def) => env[name] ?? def ?? '');
  if (Array.isArray(value)) return value.map((v) => interpolate(v, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, env)]));
  }
  return value;
}

const list = (v: unknown): string[] => (v == null ? [] : ([] as unknown[]).concat(v).map(String));

export function parseCredentials(frontmatter: Record<string, unknown>, file: string, env: NodeJS.ProcessEnv = process.env): CredentialsSpec {
  const fm = interpolate(frontmatter, env) as Record<string, any>;
  const login = (fm.login ?? {}) as Record<string, unknown>;
  const personas: Record<string, CredentialPersona> = {};
  for (const [name, raw] of Object.entries((fm.personas ?? {}) as Record<string, Record<string, unknown>>)) {
    personas[name] = {
      username: String(raw.username ?? ''),
      password: String(raw.password ?? ''),
      roles: list(raw.roles ?? name),
      landsOn: raw.landsOn ? String(raw.landsOn) : undefined,
      welcomeText: raw.welcomeText ? String(raw.welcomeText) : undefined,
    };
  }
  const logout = fm.logout as Record<string, unknown> | undefined;
  return {
    file,
    baseURL: fm.baseURL ? String(fm.baseURL) : undefined,
    landing: fm.landing ? String(fm.landing) : undefined,
    login: {
      route: String(login.route ?? '/login'),
      usernameField: login.usernameField ? String(login.usernameField) : undefined,
      passwordField: login.passwordField ? String(login.passwordField) : undefined,
      submit: login.submit ? String(login.submit) : undefined,
      failureMessage: login.failureMessage ? String(login.failureMessage) : undefined,
      protectedRoutes: list(login.protectedRoutes),
    },
    logout: logout
      ? { route: logout.route ? String(logout.route) : undefined, button: logout.button ? String(logout.button) : undefined, landsOn: logout.landsOn ? String(logout.landsOn) : undefined }
      : undefined,
    personas,
  };
}

function find(dir: string, name: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return full;
    if (e.isDirectory()) {
      const hit = find(full, name);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** The real (git-ignored) credentials note, if the vault has one. The sample is never used for runs. */
export function loadCredentials(vaultDirs: string[], env: NodeJS.ProcessEnv = process.env): CredentialsSpec | undefined {
  for (const dir of vaultDirs) {
    const file = find(dir, CREDENTIALS_FILE);
    if (!file) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const fm = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
    return parseCredentials(fm ? (YAML.parse(fm[1]) ?? {}) : {}, file, env);
  }
  return undefined;
}

export function hasSampleOnly(vaultDirs: string[]): boolean {
  return vaultDirs.some((d) => find(d, SAMPLE_CREDENTIALS_FILE)) && !vaultDirs.some((d) => find(d, CREDENTIALS_FILE));
}

const SECRET_KEY = /^(pass(word)?|pwd|secret|client[-_]?secret|token|api[-_]?key|otp|totp[-_]?seed)$/i;

/** Every secret value in a frontmatter tree (after interpolation) — used to scrub output. */
export function secretValues(value: unknown, key = '', env: NodeJS.ProcessEnv = process.env): string[] {
  const v = interpolate(value, env);
  if (typeof v === 'string') return SECRET_KEY.test(key) && v.length >= 3 ? [v] : [];
  if (Array.isArray(v)) return v.flatMap((x) => secretValues(x, key, env));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => secretValues(x, k, env));
  return [];
}

export function redact(text: string, secrets: string[]): string {
  return [...new Set(secrets)].sort((a, b) => b.length - a.length).reduce((t, s) => t.split(s).join('••••••'), text);
}

/** Masks secret-looking keys in a frontmatter object (for display). */
export function maskFrontmatter(value: unknown, key = ''): unknown {
  if (typeof value === 'string' || typeof value === 'number') return SECRET_KEY.test(key) ? '••••••' : value;
  if (Array.isArray(value)) return value.map((v) => maskFrontmatter(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskFrontmatter(v, k)]));
  return value;
}

/**
 * "Expected behaviour" scenarios derived from the credentials note, so a brand-new vault already
 * verifies the login contract: landing pages, redirects, wrong password, logout.
 */
export function credentialScenarios(spec: CredentialsSpec, featureId: string): Scenario[] {
  const out: Scenario[] = [];
  const add = (name: string, steps: [string, string][], tags: string[] = ['auth']) =>
    out.push({ id: `${featureId}::${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, tags, steps: steps.map(([keyword, text]) => ({ keyword, text })) });
  const { login } = spec;

  if (spec.landing) {
    add('Anonymous visitor lands on the expected page', [
      ['Given', 'I am not logged in'],
      ['When', 'I navigate to "/"'],
      ['Then', `I should be on the "${spec.landing}" page`],
    ]);
  }
  for (const route of login.protectedRoutes) {
    add(`Anonymous visit to ${route} redirects to login`, [
      ['Given', 'I am not logged in'],
      ['When', `I navigate to "${route}"`],
      ['Then', `I should be redirected to the "${login.route}" page`],
    ]);
  }
  for (const [name, p] of Object.entries(spec.personas)) {
    const steps: [string, string][] = [['Given', `I am logged in as "${name}"`]];
    if (p.landsOn) steps.push(['Then', `I should be on the "${p.landsOn}" page`]);
    if (p.welcomeText) steps.push([p.landsOn ? 'And' : 'Then', `I should see "${p.welcomeText}"`]);
    if (steps.length > 1) add(`${name} logs in and lands on the expected page`, steps, ['auth', 'smoke']);
  }
  const first = Object.keys(spec.personas)[0];
  if (first) {
    const steps: [string, string][] = [
      ['Given', `I am on the "${login.route}" page`],
      ['When', `I log in as "${first}" with a wrong password`],
      ['Then', `I should remain on the "${login.route}" page`],
    ];
    if (login.failureMessage) steps.push(['And', `I should see an error "${login.failureMessage}"`]);
    add('Wrong password is rejected', steps);
  }
  if (first && spec.logout && (spec.logout.route || spec.logout.button)) {
    const where = spec.logout.landsOn ?? login.route;
    const protectedPage = login.protectedRoutes[0] ?? spec.personas[first].landsOn;
    const steps: [string, string][] = [
      ['Given', `I am logged in as "${first}"`],
      ['When', spec.logout.button ? `I click "${spec.logout.button}"` : `I navigate to "${spec.logout.route}"`],
      ['Then', `I should be on the "${where}" page`],
    ];
    if (protectedPage) {
      steps.push(['When', `I navigate to "${protectedPage}"`], ['Then', `I should be redirected to the "${login.route}" page`]);
    }
    add('Logout ends the session', steps);
  }
  return out;
}
