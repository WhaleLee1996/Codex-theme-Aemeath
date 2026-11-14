// Keep native module access behind the adapter and use only the app's existing
// singleton instances. The Rspack entry is already loaded by native index.html;
// importing that same URL reuses it and never executes module factories again.
export async function loadNativeBindings(doc, compatibility, options = {}, onError = () => {}) {
  const importModule = options.importModule ?? (url => import(url));
  if (options.shared) {
    return {
      getServices: () => options.shared[compatibility.services.export],
      getCloud: options.cloudModule ? () => options.cloudModule[compatibility.cloud.client] : null
    };
  }
  if (compatibility.loader?.kind === 'rspack') {
    let requireNative;
    try {
      const entry = await importModule(new URL(compatibility.loader.module, doc.baseURI).href);
      requireNative = entry[compatibility.loader.export];
      if (typeof requireNative !== 'function' || !requireNative.c) throw new Error('Native module cache is unavailable');
    } catch (error) { onError(error); }
    // These getters also handle startup: native modules/services may become
    // ready later. Catalog refresh then reads the same live exports.
    const cached = spec => requireNative?.c?.[spec.moduleId]?.exports?.[spec.export ?? spec.client];
    return {getServices: () => cached(compatibility.services), getCloud: () => cached(compatibility.cloud)};
  }
  let shared, cloud;
  try { shared = await importModule(new URL(compatibility.services.module, doc.baseURI).href); } catch (error) { onError(error); }
  try {
    cloud = options.cloudModule ?? await importModule(new URL(compatibility.cloud.module, doc.baseURI).href);
    cloud[compatibility.cloud.initialize]?.();
  } catch (error) { onError(error); }
  return {getServices: () => shared?.[compatibility.services.export], getCloud: cloud ? () => cloud[compatibility.cloud.client] : null};
}
