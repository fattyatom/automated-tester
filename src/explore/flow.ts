import type { Page } from '@playwright/test';
import { Feature, ProductModel, routeRegex } from '../knowledge/model';
import { fillBaseline, findSubmit } from './interact';

export const pathOf = (page: Page) => new URL(page.url()).pathname;

/**
 * Drives a flow from its first step with valid baseline data, stopping when `stopAt` is the
 * current step (0 = just open the first step). Throws with a precise message if the app does not
 * advance — that itself is a useful signal (docs and product disagree).
 */
export async function walkFlow(page: Page, model: ProductModel, flow: Feature, stopAt: number): Promise<void> {
  const steps = flow.flow.map((id) => model.byId.get(id)!);
  await page.goto(steps[0].route!);
  for (let i = 0; i < stopAt; i++) {
    const step = steps[i];
    const next = steps[i + 1];
    await fillBaseline(page, step.fields);
    await (await findSubmit(page, step.submit)).click();
    await page.waitForLoadState('domcontentloaded');
    if (next?.route && !routeRegex(next.route).test(pathOf(page))) {
      throw new Error(`Flow "${flow.title}" did not advance from "${step.title}" to "${next.title}" (${next.route}); now at ${pathOf(page)}. Check the example values in the vault.`);
    }
  }
}
