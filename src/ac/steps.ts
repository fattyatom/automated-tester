import { expect, type Page } from '@playwright/test';
import type { QaConfig } from '../config';
import type { Feature, ProductModel } from '../knowledge/model';
import { fillParams, hasParams, routeRegex } from '../knowledge/model';
import { fillField, findAction, findField, visibleErrors } from '../explore/interact';
import type { QaSession } from '../explore/session';

export interface StepContext {
  page: Page;
  qa: QaSession;
  model: ProductModel;
  feature: Feature;
  config: QaConfig;
  /** Values remembered across steps ("I remember the order number"). */
  vars: Map<string, string>;
}

export interface StepDefinition {
  pattern: RegExp;
  /** Example phrasing — shown by `npm run qa -- steps` and used by the ac-normalizer agent. */
  example: string;
  run: (ctx: StepContext, ...args: string[]) => Promise<void>;
}

// Subject prefix shared by all steps: "I", "the user", "a customer", "they"...
const S = String.raw`(?:i|the user|user|they|he|she|(?:the |an? )?(?:customer|admin|visitor|guest|shopper|member))`;
const Q = String.raw`"([^"]*)"`;
const step = (source: string, example: string, run: StepDefinition['run']): StepDefinition => ({
  pattern: new RegExp(`^${source}$`, 'i'),
  example,
  run,
});

/** Resolves a quoted page reference ("Profile", "/profile", "the checkout page") to a path. */
export function resolveTarget(ctx: StepContext, ref: string): string {
  const name = ref.trim().replace(/^the\s+/i, '').replace(/\s+(page|screen|route)$/i, '');
  if (/^(\/|https?:)/.test(name)) return name;
  const id = ctx.model.graph.resolve(name) ?? ctx.model.graph.resolve(`${name} page`);
  const feature = id ? ctx.model.byId.get(id) : ctx.model.features.find((f) => f.title.toLowerCase() === name.toLowerCase());
  if (feature?.route) return hasParams(feature.route) && ctx.vars.has('id') ? fillParams(feature.route, ctx.vars.get('id')!) : feature.route;
  if (feature?.flow.length) {
    const first = ctx.model.byId.get(feature.flow[0]);
    if (first?.route) return first.route;
  }
  throw new Error(`Cannot resolve "${ref}" to a route — add \`route:\` to the note's frontmatter or use a path`);
}

const expectedPath = (ctx: StepContext, ref: string) => {
  const target = resolveTarget(ctx, ref);
  return /^https?:/.test(target) ? new RegExp(target.replace(/[.?+^$]/g, '\\$&')) : routeRegex(target);
};

export const builtInSteps: StepDefinition[] = [
  // --- Session ---------------------------------------------------------------------------
  step(String.raw`${S} (?:am|is|are) (?:logged|signed) in(?: as (?:an? |the )?"?([\w .@-]+?)"?)?`, 'I am logged in as "customer"', async (ctx, who) => {
    await ctx.qa.login(who?.trim());
  }),
  step(String.raw`${S} (?:am|is|are) (?:not logged in|logged out|signed out|anonymous|an? (?:guest|anonymous user|visitor))`, 'I am not logged in', async (ctx) => {
    await ctx.page.context().clearCookies();
  }),
  step(String.raw`${S} (?:log|sign)s? (?:in|on) (?:as|with) ${Q}(?: and (?:password )?${Q})?`, 'I log in with "user@example.com" and "Passw0rd!"', async (ctx, user, pass) => {
    const { auth } = ctx.config;
    await ctx.page.goto(auth.loginRoute);
    await fillField(await findField(ctx.page, auth.usernameField), user);
    await fillField(await findField(ctx.page, auth.passwordField), pass ?? '');
    await (await findAction(ctx.page, auth.submit)).click();
    await ctx.page.waitForLoadState('domcontentloaded');
  }),

  // --- Navigation ------------------------------------------------------------------------
  step(String.raw`${S} (?:am|is|are) on (?:the )?"?(.+?)"?(?: page| screen)?`, 'I am on the "Profile" page', async (ctx, target) => {
    await ctx.page.goto(resolveTarget(ctx, target));
  }),
  step(String.raw`${S} (?:visits?|navigates? to|go(?:es)? to|opens?|browses? to) (?:the )?"?(.+?)"?(?: page| screen)?`, 'I navigate to "/checkout/shipping"', async (ctx, target) => {
    await ctx.page.goto(resolveTarget(ctx, target));
  }),
  step(String.raw`${S} (?:reloads?|refresh(?:es)?) the page`, 'I reload the page', async (ctx) => {
    await ctx.page.reload();
  }),
  step(String.raw`${S} (?:go(?:es)? back|navigates? back|press(?:es)? (?:the )?back(?: button)?)`, 'I go back', async (ctx) => {
    await ctx.page.goBack();
  }),

  // --- Input -----------------------------------------------------------------------------
  step(String.raw`${S} (?:fills?(?: in)?|enters?|types?|sets?) (?:the )?${Q}(?: field)? (?:with|as|to) ${Q}`, 'I fill "Email" with "user@example.com"', async (ctx, field, value) => {
    await fillField(await findField(ctx.page, field), value);
  }),
  step(String.raw`${S} (?:enters?|types?|inputs?) ${Q} (?:in|into|as) (?:the )?${Q}(?: field)?`, 'I enter "Casey" into "Display name"', async (ctx, value, field) => {
    await fillField(await findField(ctx.page, field), value);
  }),
  step(String.raw`${S} (?:clears?|empties?) (?:the )?${Q}(?: field)?`, 'I clear the "Display name" field', async (ctx, field) => {
    await (await findField(ctx.page, field)).fill('');
  }),
  step(String.raw`${S} (?:selects?|chooses?|picks?) ${Q} (?:from|in|for) (?:the )?${Q}(?: dropdown| list| field)?`, 'I select "Australia" from "Country"', async (ctx, value, field) => {
    await fillField(await findField(ctx.page, field), value);
  }),
  step(String.raw`${S} (un)?checks? (?:the )?${Q}(?: checkbox| option)?`, 'I check "Remember me"', async (ctx, un, field) => {
    await (await findField(ctx.page, field)).setChecked(!un);
  }),
  step(String.raw`${S} (?:fills? in|completes?) (?:the )?(?:form|${Q}(?: form)?) with valid (?:data|details|values)`, 'I fill in the form with valid data', async (ctx, ref) => {
    const feature = ref ? ctx.model.byId.get(ctx.model.graph.resolve(ref) ?? '') ?? ctx.feature : ctx.feature;
    const { fillBaseline } = await import('../explore/interact');
    await fillBaseline(ctx.page, feature.fields);
  }),

  // --- Actions ---------------------------------------------------------------------------
  step(String.raw`${S} (?:clicks?|press(?:es)?|taps?|submits?|selects?|chooses?) (?:on )?(?:the )?${Q}(?: button| link| tab| menu item)?`, 'I click "Save profile"', async (ctx, name) => {
    await (await findAction(ctx.page, name)).click();
    await ctx.page.waitForLoadState('domcontentloaded');
  }),
  step(String.raw`${S} (?:double[- ]clicks?) (?:on )?(?:the )?${Q}(?: button| link)?`, 'I double-click "Place order"', async (ctx, name) => {
    await (await findAction(ctx.page, name)).dblclick();
    await ctx.page.waitForLoadState('domcontentloaded');
  }),

  // --- Assertions ------------------------------------------------------------------------
  step(String.raw`${S} should (?:see|be shown) (?:the (?:text|message) )?${Q}`, 'I should see "Welcome back"', async (ctx, text) => {
    await expect(ctx.page.getByText(text).first()).toBeVisible();
  }),
  step(String.raw`${S} should not (?:see|be shown) (?:the (?:text|message) )?${Q}`, 'I should not see "Admin"', async (ctx, text) => {
    await expect(ctx.page.getByText(text)).toHaveCount(0);
  }),
  step(String.raw`(?:${S} should (?:see|get) )?an? (?:error|validation)(?: error| message)*(?:(?: saying| reading| that says| containing)? ${Q})?(?: (?:is|should be) (?:shown|displayed))?`, 'I should see an error "Invalid email or password"', async (ctx, text) => {
    if (text) {
      await expect(ctx.page.getByText(text).first()).toBeVisible();
      return;
    }
    await expect.poll(() => visibleErrors(ctx.page, ctx.config.explore.errorText).then((e) => e.length), { message: 'expected a visible validation error' }).toBeGreaterThan(0);
  }),
  step(String.raw`${S} should (?:be|land|end up) (?:on|at|redirected to|taken to|sent to|returned to) (?:the )?"?(.+?)"?(?: page| screen)?`, 'I should be redirected to the "Dashboard" page', async (ctx, target) => {
    await expect(ctx.page).toHaveURL((u) => expectedPath(ctx, target).test(u.pathname) || expectedPath(ctx, target).test(u.href));
  }),
  step(String.raw`${S} should (?:stay|remain) on (?:the )?"?(.+?)"?(?: page| screen)?`, 'I should remain on the "Login" page', async (ctx, target) => {
    await expect(ctx.page).toHaveURL((u) => expectedPath(ctx, target).test(u.pathname));
  }),
  step(String.raw`the (?:url|address) should (?:contain|include) ${Q}`, 'the URL should contain "/orders/"', async (ctx, part) => {
    await expect(ctx.page).toHaveURL(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }),
  step(String.raw`the (?:page )?title should (?:be|contain) ${Q}`, 'the page title should contain "Checkout"', async (ctx, title) => {
    await expect(ctx.page).toHaveTitle(new RegExp(title, 'i'));
  }),
  step(String.raw`(?:the )?${Q}(?: button| link| field)? should be (enabled|disabled|visible|hidden)`, 'the "Place order" button should be enabled', async (ctx, name, state) => {
    const el = await findAction(ctx.page, name).catch(() => findField(ctx.page, name));
    const map = { enabled: 'toBeEnabled', disabled: 'toBeDisabled', visible: 'toBeVisible', hidden: 'toBeHidden' } as const;
    await expect(el)[map[state.toLowerCase() as keyof typeof map]]();
  }),
  step(String.raw`(?:the )?${Q}(?: field)? should (?:contain|have(?: the)? value|equal) ${Q}`, 'the "Display name" field should contain "Casey"', async (ctx, field, value) => {
    await expect(await findField(ctx.page, field)).toHaveValue(value);
  }),
  step(String.raw`${S} (?:remembers?|notes?|stores?) the (\w+) from the url`, 'I remember the id from the URL', async (ctx, name) => {
    const last = new URL(ctx.page.url()).pathname.split('/').filter(Boolean).pop() ?? '';
    ctx.vars.set(name.toLowerCase(), last);
  }),
];

export interface CompiledStep {
  keyword: string;
  text: string;
  def?: StepDefinition;
  args: string[];
}

export function compileStep(text: string, keyword: string, defs: StepDefinition[]): CompiledStep {
  const clean = text.trim().replace(/[.;]$/, '').replace(/[“”]/g, '"');
  for (const def of defs) {
    const m = clean.match(def.pattern);
    if (m) return { keyword, text: clean, def, args: m.slice(1) };
  }
  return { keyword, text: clean, args: [] };
}

export const allSteps = (config: QaConfig) => [...config.steps, ...builtInSteps];
