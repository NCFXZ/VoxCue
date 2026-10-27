import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import workspace from '../../scripts/workspace.mjs';

// Resolve exactly the validator used by the fixed SDK, rather than testing an
// unrelated top-level installation. No account or subprocess is started here.
const sdk = createRequire(workspace.platformRequire.resolve('@github/copilot-sdk'));
const { z } = sdk('zod');
describe('SDK validation resource bounds', () => {
  for (const kind of ['array', 'set', 'map'] as const) {
    it(`${kind} rejects an oversized collection before validating its elements`, () => {
      let visited = 0;
      const item = z.preprocess((value: unknown) => {
        visited++;
        return value;
      }, z.string());
      const values = Array.from({ length: 4096 }, (_, i) => i);
      const [schema, input] =
        kind === 'array'
          ? [z.array(item).max(32), values]
          : kind === 'set'
            ? [z.set(item).max(32), new Set(values)]
            : [z.map(item, item).max(32), new Map(values.map((value) => [value, value]))];
      const result = schema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].code).toBe('too_big');
      expect(visited).toBe(0);
    });
  }
});
