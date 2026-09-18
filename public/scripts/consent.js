const storageKey = 'staniverse:analytics-consent';

export function decisionFrom(raw) {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw);
    return stored?.v === 1 && ['granted', 'denied'].includes(stored.decision) ? stored.decision : null;
  } catch {
    return null;
  }
}

export function serializeDecision(decision, now = new Date()) {
  return JSON.stringify({ v: 1, decision, at: now.toISOString() });
}

export function loadMetrika(counterId) {
  if (!/^\d+$/.test(String(counterId)) || document.documentElement.dataset.metrikaLoaded === 'true') return;
  document.documentElement.dataset.metrikaLoaded = 'true';
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.append(script);
  window.ym(Number(counterId), 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: false,
  });
}

function readDecision() {
  try {
    return decisionFrom(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

function saveDecision(decision) {
  try {
    localStorage.setItem(storageKey, serializeDecision(decision));
  } catch {
    // The choice still applies to this page when storage is unavailable.
  }
}

function initializeConsent() {
  const banner = document.querySelector('[data-consent-banner]');
  const resetButtons = document.querySelectorAll('[data-consent-reset]');
  resetButtons.forEach((button) => button.addEventListener('click', () => {
    try { localStorage.removeItem(storageKey); } catch {}
    location.reload();
  }));
  if (!banner) return;

  const counterId = banner.dataset.counter || '';
  const decision = readDecision();
  if (decision === 'granted') {
    loadMetrika(counterId);
    return;
  }
  if (decision === 'denied') return;

  banner.hidden = false;
  banner.querySelector('[data-consent-accept]')?.addEventListener('click', () => {
    saveDecision('granted');
    loadMetrika(counterId);
    banner.hidden = true;
  });
  banner.querySelector('[data-consent-decline]')?.addEventListener('click', () => {
    saveDecision('denied');
    banner.hidden = true;
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeConsent, { once: true });
  else initializeConsent();
}
