import { describe, expect, it, vi } from 'vitest';

import { withMinimumInterval } from '../src/framework/pacing.js';
import { createLogger } from '../src/logger.js';

const logger = createLogger('silent');

describe('withMinimumInterval', () => {
  it('runs the first cycle, skips within the interval, runs again after it', async () => {
    const collect = vi.fn(async () => 'collected');
    let clock = 1_000_000;
    const paced = withMinimumInterval(
      { sourceId: 'celestrak-active-tle', collect },
      7_200_000,
      logger,
      () => clock,
    );

    await expect(paced.collect()).resolves.toBe('collected');

    clock += 300_000;
    await expect(paced.collect()).resolves.toBeUndefined();
    clock += 6_899_999;
    await expect(paced.collect()).resolves.toBeUndefined();
    expect(collect).toHaveBeenCalledTimes(1);

    clock += 1;
    await expect(paced.collect()).resolves.toBe('collected');
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('counts a failed attempt against the interval', async () => {
    const collect = vi.fn(async () => {
      throw new Error('provider unreachable');
    });
    let clock = 0;
    const paced = withMinimumInterval(
      { sourceId: 'celestrak-active-tle', collect },
      7_200_000,
      logger,
      () => clock,
    );

    await expect(paced.collect()).rejects.toThrow('provider unreachable');
    clock += 300_000;
    await expect(paced.collect()).resolves.toBeUndefined();
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it('preserves the wrapped sourceId and rejects invalid intervals', () => {
    const collector = { sourceId: 'celestrak-active-tle', collect: async () => undefined };
    expect(withMinimumInterval(collector, 1, logger).sourceId).toBe('celestrak-active-tle');
    expect(() => withMinimumInterval(collector, 0, logger)).toThrow('positive integer');
    expect(() => withMinimumInterval(collector, 1.5, logger)).toThrow('positive integer');
  });
});
