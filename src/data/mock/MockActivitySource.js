import { deriveWorkoutName } from '../../domain/deriveWorkoutName.js'
import sampleRun from '../../../fixtures/sample-run.json'

/**
 * Dev/test adapter. Always resolves the same fixture regardless of the ref
 * passed in — lets the whole UI be built and tested with the parser never on
 * the critical path. See ARCHITECTURE.md §11 build order.
 * @implements {import('../ActivitySource.js').ActivitySource}
 */
export class MockActivitySource {
  kind = 'mock'

  /** @returns {Promise<import('../../domain/types.js').Activity>} */
  load() {
    const startTime = new Date(sampleRun.startTime)
    return Promise.resolve({
      ...sampleRun,
      startTime,
      // Computed at load time (not hardcoded into the fixture JSON) so it
      // exercises the same time-of-day-dependent code path real data uses,
      // rather than a string that could silently contradict the viewer's
      // local time — see deriveWorkoutName.js.
      name: deriveWorkoutName({ sport: sampleRun.sport, startTime }),
    })
  }
}
