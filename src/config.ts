import type { Page } from '@playwright/test';
import type { StepDefinition } from './ac/steps';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const SEVERITY_ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

export interface Persona {
  username: string;
  password: string;
  roles: string[];
}

export interface AuthConfig {
  /** Route of the login page. */
  loginRoute: string;
  /** Label / placeholder / name of the username field. */
  usernameField: string;
  /** Label / placeholder / name of the password field. */
  passwordField: string;
  /** Accessible name of the submit button. */
  submit: string;
  /** Override when login is not a simple form (SSO, MFA, API token...). */
  login?: (page: Page, persona: Persona, config: QaConfig) => Promise<void>;
}

export interface ExploreConfig {
  /** Findings at or above this severity fail the test. */
  failOn: Severity;
  /** Text that indicates the app intentionally blocked access (guard / prerequisite message). */
  guardText: RegExp;
  /** Text that indicates a validation error is being shown. */
  errorText: RegExp;
  /** Text that indicates a "not found" page. */
  notFoundText: RegExp;
  /** Values used to tamper with route params like /orders/:id. */
  paramValues: string[];
  /** Fuzz text fields with XSS / injection / unicode payloads. */
  securityPayloads: boolean;
  /** Repeat negative field cases with client-side validation stripped (tests the server). */
  serverSideBypass: boolean;
  crawl: { maxPages: number; exclude: RegExp[] };
}

export interface QaConfig {
  baseURL: string;
  /** One or more Obsidian vault directories describing the product. */
  vault: string[];
  /** Agent-written notes merged over the vault (same conventions, never edits the real vault). */
  overlays: string[];
  personas: Record<string, Persona>;
  auth: AuthConfig;
  /** Project-specific step definitions; checked before the built-in library. */
  steps: StepDefinition[];
  explore: ExploreConfig;
  report: {
    outputDir: string;
    /** If set, a run summary note with [[wikilinks]] is written into this vault folder. */
    writeToVault?: string;
  };
  /** Working dir for analysis output (model.json, plan.json, coverage.md, discovery). */
  workDir: string;
}

export type QaConfigInput = Pick<QaConfig, 'baseURL' | 'personas'> & {
  vault: string | string[];
  overlays?: string[];
  auth: AuthConfig;
  steps?: StepDefinition[];
  explore?: Partial<Omit<ExploreConfig, 'crawl'>> & { crawl?: Partial<ExploreConfig['crawl']> };
  report?: Partial<QaConfig['report']>;
  workDir?: string;
};

export function defineQaConfig(input: QaConfigInput): QaConfig {
  const explore = input.explore ?? {};
  return {
    baseURL: input.baseURL,
    vault: Array.isArray(input.vault) ? input.vault : [input.vault],
    overlays: input.overlays ?? ['.qa/overlay'],
    personas: input.personas,
    auth: input.auth,
    steps: input.steps ?? [],
    workDir: input.workDir ?? '.qa',
    report: { outputDir: 'qa-report', ...input.report },
    explore: {
      failOn: explore.failOn ?? 'high',
      guardText: explore.guardText ?? /complete .* first|not (?:allowed|authori[sz]ed|permitted)|forbidden|access denied|please (?:log|sign) in|start (?:over|again)/i,
      errorText: explore.errorText ?? /required|invalid|must be|too (?:long|short)|not valid|error|please (?:enter|provide|use)|at (?:most|least)/i,
      notFoundText: explore.notFoundText ?? /not found|404|doesn.t exist|does not exist/i,
      paramValues: explore.paramValues ?? ['0', '-1', '999999999', 'abc', "1'", '%00', '../../etc/passwd'],
      securityPayloads: explore.securityPayloads ?? true,
      serverSideBypass: explore.serverSideBypass ?? true,
      crawl: { maxPages: 40, exclude: [/logout|sign-?out/i], ...explore.crawl },
    },
  };
}

export function personaFor(config: QaConfig, nameOrRole?: string): [string, Persona] {
  const entries = Object.entries(config.personas);
  if (!entries.length) throw new Error('No personas configured in qa.config.ts');
  if (!nameOrRole) return entries[0];
  const key = nameOrRole.toLowerCase().trim();
  const hit =
    entries.find(([name]) => name.toLowerCase() === key) ??
    entries.find(([, p]) => p.roles.some((r) => r.toLowerCase() === key));
  if (!hit) throw new Error(`No persona or role named "${nameOrRole}" in qa.config.ts personas`);
  return hit;
}

export function personaHasRole(persona: Persona, roles: string[]): boolean {
  if (!roles.length) return true;
  const own = persona.roles.map((r) => r.toLowerCase());
  return roles.some((r) => own.includes(r.toLowerCase()));
}
