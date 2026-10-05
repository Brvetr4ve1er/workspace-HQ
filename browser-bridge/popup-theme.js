// Runs in <head> before first paint: pick the token theme from the OS light/dark
// preference and follow changes while the popup is open. (The extension can't
// read the app's own theme setting — that lives in the Electron process.)
(function () {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => document.documentElement.setAttribute('data-hq-theme', mq.matches ? 'light' : 'dark');
    apply();
    mq.addEventListener('change', apply);
  } catch { /* keep the dark default from the markup */ }
})();
