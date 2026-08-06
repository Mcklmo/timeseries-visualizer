import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// With `globals: false` in vite.config.js, @testing-library/react's automatic
// afterEach cleanup never registers (it looks for a global `afterEach`) — so
// without this, DOM from one test leaks into the next within the same file.
afterEach(cleanup)

// Recharts' ResponsiveContainer needs ResizeObserver and real layout, neither
// of which jsdom provides. Stub it so charts mount with a fixed size in tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub
