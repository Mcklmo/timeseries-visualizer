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
    return Promise.resolve({
      ...sampleRun,
      startTime: new Date(sampleRun.startTime),
    })
  }
}
