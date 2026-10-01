import { test as base } from '@playwright/test';
import config from '../qa.config';
import { ProductModel, loadModel } from './knowledge/model';
import { TestPlan, buildPlan } from './planner/plan';
import { QaSession } from './explore/session';

let cache: { model: ProductModel; plan: TestPlan } | undefined;

/** Model + plan are rebuilt from the vault at collection time, so tests always reflect the docs. */
export function load(): { config: typeof config; model: ProductModel; plan: TestPlan } {
  if (!cache) {
    const model = loadModel(config.vault, config.overlays);
    cache = { model, plan: buildPlan(model, config) };
  }
  return { config, ...cache };
}

export const test = base.extend<{ qa: QaSession }>({
  qa: async ({ page, browser }, use, testInfo) => {
    const session = new QaSession(page, browser, testInfo, config);
    await use(session);
    await session.finish();
  },
});

export { expect } from '@playwright/test';
export { config };
