// jsdom has no ResizeObserver, and the map measures its own frame with one.
// A no-op stub is right here: layout has no meaning in jsdom, and these tests
// assert what a screen *says*, not how large it is.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
}

// Neither does it implement pointer capture, which the map's pan handler calls.
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}
