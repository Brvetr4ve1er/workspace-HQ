// Realm registry — the shell renders whatever is registered here, so a new
// realm = a new folder + one register() call in boot. Realm interface (charter
// PART III): manifest {id, sigil, lexKey, order, badge(data), enabled(data)},
// view {mount(el, ctx), unmount()}.
const realms = [];

export function register(manifest, view) {
  realms.push({ manifest, view });
}

export function ordered() {
  return [...realms].sort((a, b) => a.manifest.order - b.manifest.order);
}

export function byId(id) {
  return realms.find((r) => r.manifest.id === id) || null;
}
