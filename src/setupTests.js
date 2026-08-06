import '@testing-library/jest-dom/vitest'

// Recharts' ResponsiveContainer needs ResizeObserver and real layout, neither
// of which jsdom provides. Stub it so charts mount with a fixed size in tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub
