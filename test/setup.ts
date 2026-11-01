import { beforeEach, vi } from 'vitest';

// The engine logs the causes of failures it reports; tests exercise those on purpose.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// jsdom does no layout and leaves out Range's geometry methods, which Chrome has.
// Tests that care about positions inject their own measurements.
if (!('getClientRects' in Range.prototype)) {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    value: () => [] as unknown as DOMRectList,
  });
}
