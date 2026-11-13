// Runs before the original Harness bundles. Only fill APIs that are missing in
// older Android System WebViews; never replace native implementations.
(() => {
  globalThis.__TeamSeekNativeFeatures__ = {
    nativeHasOwn: typeof Object.hasOwn === 'function', nativeWithResolvers: typeof Promise.withResolvers === 'function',
    nativeRandomUUID: typeof crypto.randomUUID === 'function', nativeAbortAny: typeof AbortSignal.any === 'function',
    nativeFindLast: typeof Array.prototype.findLast === 'function', nativeArrayAt: typeof Array.prototype.at === 'function'
  };
  const define = (target, key, value) => {
    if (typeof target[key] !== 'function') Object.defineProperty(target, key, { value, configurable: true, writable: true });
  };
  define(Object, 'hasOwn', (object, key) => Object.prototype.hasOwnProperty.call(object, key));
  define(Promise, 'withResolvers', function () {
    let resolve, reject;
    const promise = new this((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  });
  function at(index) {
    if (this == null) throw new TypeError('Invalid receiver');
    const object = Object(this), length = object.length;
    const offset = Math.trunc(Number(index)) || 0;
    const position = offset < 0 ? length + offset : offset;
    return position < 0 || position >= length ? undefined : object[position];
  }
  define(Array.prototype, 'at', at);
  define(String.prototype, 'at', at);
  for (const key of ['findLast', 'findLastIndex']) define(Array.prototype, key, function (predicate, receiver) {
    if (this == null || typeof predicate !== 'function') throw new TypeError('Invalid findLast arguments');
    const object = Object(this);
    for (let index = object.length - 1; index >= 0; index--) {
      const value = object[index];
      if (predicate.call(receiver, value, index, object)) return key === 'findLast' ? value : index;
    }
    return key === 'findLast' ? undefined : -1;
  });
  if (globalThis.crypto) define(crypto, 'randomUUID', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'));
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10).join('');
  });
  define(AbortSignal, 'any', signals => {
    const list = Array.from(signals);
    if (list.some(signal => !(signal instanceof AbortSignal))) throw new TypeError('Expected AbortSignal');
    const controller = new AbortController(), listeners = [];
    const cleanup = () => { for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener); };
    for (const signal of list) {
      if (signal.aborted) { cleanup(); controller.abort(signal.reason); break; }
      const listener = () => { cleanup(); controller.abort(signal.reason); };
      listeners.push([signal, listener]); signal.addEventListener('abort', listener, { once: true });
    }
    return controller.signal;
  });
})();
