import { expect, test } from '@playwright/test';
import { builtInSteps, compileStep } from '../../src/ac/steps';
import { KnowledgeGraph } from '../../src/knowledge/graph';
import { credentialScenarios, hasSampleOnly, loadCredentials, parseCredentials, secretValues } from '../../src/knowledge/credentials';
import { applyRules, buildModel, loadModel, parseCriteria, parseFieldTable, routeRegex } from '../../src/knowledge/model';
import fs from 'node:fs';
import path from 'node:path';
import { loadVault, parseNote } from '../../src/knowledge/vault';
import { buildPlan } from '../../src/planner/plan';
import config from '../../qa.config';

const VAULT = ['./examples/vault'];

test.describe('vault parsing', () => {
  test('frontmatter, wikilinks (incl. aliases/headings/embeds), tags, sections', () => {
    const note = parseNote('Notes/Thing.md', `---
route: /thing
requires: "[[Login]]"
tags: [alpha]
---
# Thing
See [[Other Note|the other]] and [[Deep#Section]] and ![[Diagram.png]]. #beta
\`[[NotALink]]\`
## Acceptance Criteria
- Given x
`);
    expect(note.id).toBe('thing');
    expect(note.frontmatter.route).toBe('/thing');
    expect(note.links.map((l) => l.target)).toEqual(['Login', 'Other Note', 'Deep', 'Diagram.png']);
    expect(note.links[0].context).toBe('requires');
    expect(note.links[2].heading).toBe('Section');
    expect(note.links[3].embed).toBe(true);
    expect(note.tags.sort()).toEqual(['alpha', 'beta']);
    expect(note.sections.map((s) => s.heading)).toEqual(['Thing', 'Acceptance Criteria']);
  });

  test('overlay notes merge over vault notes without touching them', () => {
    const root = test.info().outputPath('vaults');
    fs.mkdirSync(path.join(root, 'vault'), { recursive: true });
    fs.mkdirSync(path.join(root, 'overlay'), { recursive: true });
    fs.writeFileSync(path.join(root, 'vault', 'Page.md'), '---\nroute: /old\nauth: required\n---\n# Page\nSee [[Other]]');
    fs.writeFileSync(path.join(root, 'overlay', 'Page.md'), '---\nroute: /new\n---\n## Acceptance Criteria\nScenario: x\n  Given I reload the page');
    const note = loadVault([path.join(root, 'vault')], [path.join(root, 'overlay')]).get('page')!;
    expect(note.frontmatter).toMatchObject({ route: '/new', auth: 'required' });
    expect(note.sections.map((s) => s.heading)).toContain('Acceptance Criteria');
    expect(note.links.map((l) => l.target)).toContain('Other');
    expect(note.file).toBe(path.join(root, 'vault', 'Page.md'));
  });

  test('graph resolves titles and aliases, finds orphans, unresolved links and paths', () => {
    const notes = new Map(
      [
        parseNote('A.md', '---\naliases: [Alpha]\n---\nlinks [[B]]'),
        parseNote('B.md', 'links [[C]] and [[Missing]]'),
        parseNote('C.md', 'end'),
        parseNote('Lonely.md', 'nothing'),
      ].map((n) => [n.id, n]),
    );
    const g = new KnowledgeGraph(notes);
    expect(g.resolve('alpha')).toBe('a');
    expect(g.orphans()).toEqual(['lonely']);
    expect(g.unresolved).toEqual([{ from: 'b', target: 'Missing' }]);
    expect(g.path('Alpha', 'C')).toEqual(['a', 'b', 'c']);
    expect([...g.neighbors('b', 1).keys()].sort()).toEqual(['a', 'b', 'c']);
  });
});

test.describe('acceptance criteria parsing', () => {
  test('gherkin scenarios, inline GWT bullets, vague bullets, outlines', () => {
    const { scenarios, vague } = parseCriteria(
      `
Scenario: One
  Given a
  When b
  Then c
- Given x, when y, then z
- It should be fast
Scenario Outline: Many
  Given I enter "<v>"
  Examples:
    | v |
    | 1 |
    | 2 |
`,
      'f',
    );
    expect(scenarios.map((s) => s.steps.length)).toEqual([3, 3, 1, 1]);
    expect(scenarios[1].steps.map((s) => s.keyword)).toEqual(['Given', 'When', 'Then']);
    expect(scenarios[3].steps[0].text).toBe('I enter "2"');
    expect(vague).toEqual(['It should be fast']);
  });

  test('step library matches common phrasings', () => {
    const cases = [
      'I am logged in as "admin"',
      'the user navigates to the "Profile" page',
      'I fill "Email" with "a@b.c"',
      'I enter "x" into the "Display name" field',
      'I select "Australia" from "Country"',
      'I click "Save"',
      'I should see "Saved"',
      'I should see an error "Bad"',
      'I should be redirected to the "Dashboard" page',
      'the "Place order" button should be disabled',
    ];
    for (const c of cases) expect(compileStep(c, 'Given', builtInSteps).def, c).toBeTruthy();
    expect(compileStep('I teleport to Mars', 'Given', builtInSteps).def).toBeUndefined();
  });
});

test.describe('field rules', () => {
  test('rules column is turned into constraints', () => {
    const [name, code, email, n] = parseFieldTable(`
| Field | Type | Required | Rules | Example |
|---|---|---|---|---|
| Name | text | yes | max 30 characters | Bob |
| Code | text | no | exactly 4 digits | 1234 |
| Mail | text | yes | valid email | a@b.c |
| Qty | number | | 1-10 | 2 |
`);
    expect(name).toMatchObject({ required: true, maxLength: 30, example: 'Bob' });
    expect(code).toMatchObject({ required: false, minLength: 4, maxLength: 4, pattern: '^\\d{4}$' });
    expect(email.type).toBe('email');
    expect(n).toMatchObject({ min: 1, max: 10 });
    expect(applyRules({ name: 'c', type: 'select', required: false, rules: '' }, 'options: A, B').options).toEqual(['A', 'B']);
  });

  test('route params become matchers', () => {
    expect(routeRegex('/orders/:id').test('/orders/42')).toBe(true);
    expect(routeRegex('/orders/:id').test('/orders/42/edit')).toBe(false);
  });
});

test.describe('example vault → model → plan', () => {
  const model = loadModel(VAULT);

  test('auth and flow order are inferred through the graph', () => {
    const review = model.byId.get('review order')!;
    expect(review.requiresAuth).toBe(true);
    expect(review.authReason).toContain('Checkout Flow');
    expect(model.byId.get('checkout flow')!.flow).toEqual(['shipping', 'payment', 'review order', 'order confirmation']);
    expect(model.byId.get('admin panel')!.roles).toEqual(['admin']);
  });

  test('plan contains every exploratory charter', () => {
    const plan = buildPlan(model, config);
    expect(plan.routeSkips.map((r) => r.route)).toEqual(['/checkout/payment', '/checkout/review']);
    expect(plan.roleGuards).toEqual([expect.objectContaining({ route: '/admin', persona: 'customer' })]);
    expect(plan.tampering.length).toBe(config.explore.paramValues.length);
    expect(plan.fieldCases.some((c) => c.field.name === 'Display name' && c.mode === 'server' && c.expect === 'reject')).toBe(true);
    expect(plan.stateChecks.map((s) => s.kind).sort()).toEqual(['back-then-resubmit', 'double-submit', 'reload-each-step', 'session-loss-mid-flow']);
  });
});

test.describe('credentials.md (like .env)', () => {
  const fm = {
    type: 'credentials',
    baseURL: '${QA_TEST_URL:-https://default.example}',
    landing: '/',
    login: { route: '/signin', failureMessage: 'Nope', protectedRoutes: ['/app'] },
    logout: { button: 'Sign out', landsOn: '/signin' },
    personas: { standard: { username: 'a@b.co', password: '${QA_TEST_PASS}', landsOn: '/app', welcomeText: 'Hi' } },
  };

  test('env interpolation with defaults; roles default to persona name', () => {
    const spec = parseCredentials(fm, 'credentials.md', { QA_TEST_PASS: 's3cret!' });
    expect(spec.baseURL).toBe('https://default.example');
    expect(spec.personas.standard).toMatchObject({ password: 's3cret!', roles: ['standard'] });
    expect(parseCredentials(fm, 'x', { QA_TEST_URL: 'https://ci.example' }).baseURL).toBe('https://ci.example');
  });

  test('expected behaviour becomes executable scenarios', () => {
    const scenarios = credentialScenarios(parseCredentials(fm, 'x', {}), 'credentials');
    expect(scenarios.map((s) => s.name)).toEqual([
      'Anonymous visitor lands on the expected page',
      'Anonymous visit to /app redirects to login',
      'standard logs in and lands on the expected page',
      'Wrong password is rejected',
      'Logout ends the session',
    ]);
    for (const s of scenarios) for (const st of s.steps) expect(compileStep(st.text, st.keyword, builtInSteps).def, st.text).toBeTruthy();
  });

  test('secrets are masked in agent context packs, labels are not', () => {
    const notes = new Map([parseNote('credentials.md', `---\npasswordField: Password\npersonas:\n  x:\n    password: hunter22\n---\nThe password is hunter22 [[Login]]`), parseNote('Login.md', '# Login')].map((n) => [n.id, n]));
    const ctx = new KnowledgeGraph(notes).context('Login', 1);
    expect(ctx).not.toContain('hunter22');
    expect(ctx).toContain('"passwordField":"Password"');
    expect(secretValues({ token: 'abc123', label: 'abc' })).toEqual(['abc123']);
  });

  test('real file is found, sample is ignored as a note, templates and %% comments are skipped', () => {
    const root = test.info().outputPath('cred-vault');
    fs.mkdirSync(path.join(root, 'Templates'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sample.credentials.md'), '---\ntype: credentials\n---\n');
    fs.writeFileSync(path.join(root, 'Templates', 'Page.md'), '---\nroute: /{{x}}\n---\n');
    fs.writeFileSync(path.join(root, 'Home.md'), '---\nroute: /\n---\n## Acceptance Criteria\n%%\nScenario: hidden\n  Given I reload the page\n%%\n');
    expect(hasSampleOnly([root])).toBe(true);
    expect(loadCredentials([root])).toBeUndefined();
    expect([...loadVault([root]).keys()]).toEqual(['home']);
    expect(buildModel(loadVault([root])).byId.get('home')!.scenarios).toEqual([]);

    fs.writeFileSync(path.join(root, 'credentials.md'), '---\ntype: credentials\nlogin:\n  route: /signin\n---\n');
    fs.writeFileSync(path.join(root, 'Login.md'), '---\ntype: auth\n---\n# Login');
    expect(loadCredentials([root])!.login.route).toBe('/signin');
    expect(buildModel(loadVault([root])).byId.get('login')!.route).toBe('/signin');
  });
});
