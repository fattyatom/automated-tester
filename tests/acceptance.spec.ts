/**
 * Acceptance criteria from the vault, executed through the step library.
 * One test per scenario; scenarios with unmatched steps are reported as `fixme` (not silently skipped).
 */
import { load, test } from '../src/runtime';
import { SOURCE_ANNOTATION, sourceOf } from '../src/explore/session';
import type { StepContext } from '../src/ac/steps';

const { plan, model, config } = load();
const features = [...new Set(plan.acceptance.map((a) => a.feature))];

for (const feature of features) {
  test.describe(`${feature.title}`, () => {
    for (const item of plan.acceptance.filter((a) => a.feature === feature)) {
      const details = {
        tag: item.scenario.tags.map((t) => `@${t.replace(/\s+/g, '-')}`),
        annotation: [
          { type: SOURCE_ANNOTATION, description: sourceOf(feature) },
          ...item.unmatched.map((u) => ({ type: 'unmatched-step', description: u })),
        ],
      };
      if (item.unmatched.length) {
        test.fixme(item.scenario.name, details, async () => {});
        continue;
      }
      test(item.scenario.name, details, async ({ page, qa }) => {
        qa.forFeature(feature);
        const ctx: StepContext = { page, qa, model, feature, config, vars: new Map() };
        for (const s of item.steps) {
          await test.step(`${s.keyword} ${s.text}`, () => s.def!.run(ctx, ...s.args));
        }
        await qa.inspect();
      });
    }
  });
}
