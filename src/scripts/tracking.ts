const SUPABASE_URL = 'https://wyhpcfjtmtitorinkevj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5aHBjZmp0bXRpdG9yaW5rZXZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2ODQ5MzAsImV4cCI6MjA4ODI2MDkzMH0.wjhLn9RUriD5GWRm7yho-Ke6RpsvhJWseKaQUsIrJOw';

const UID_KEY = 'aha_briefing_uid';

function setCookie(name: string, value: string, days: number) {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=None;Secure`;
}

function getCookie(name: string) {
  const nameEQ = name + '=';
  const ca = document.cookie.split(';');
  for (let c of ca) {
    c = c.trim();
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
  }
  return null;
}

function getUserId() {
  let uid = getCookie(UID_KEY);
  if (!uid) {
    uid = crypto.randomUUID();
    setCookie(UID_KEY, uid, 365);
  }
  return uid;
}

const trackedImpressions = new Set<string>();
let globalListenersAttached = false;
let diagnosticPath = '';
let diagnosticInteractionSent = false;
let diagnosticVisible15sSent = false;
let diagnosticVisibleStartedAt = 0;
let diagnosticVisibleMs = 0;
let diagnosticVisibleTimer: number | undefined;

function getGtag() {
  return (window as Window & { gtag?: (...args: unknown[]) => void }).gtag;
}

function trackGaDiagnosticEvent(eventName: 'ai_human_interaction' | 'ai_visible_15s', params: Record<string, string | number | boolean> = {}) {
  const gtag = getGtag();
  if (!gtag) return;

  gtag('event', eventName, {
    page_path: window.location.pathname,
    page_location: window.location.href,
    ...params,
  });
}

function stopVisible15sTimer() {
  if (diagnosticVisibleTimer !== undefined) {
    window.clearTimeout(diagnosticVisibleTimer);
    diagnosticVisibleTimer = undefined;
  }
}

function scheduleVisible15sTimer() {
  stopVisible15sTimer();
  if (diagnosticVisible15sSent || document.visibilityState !== 'visible') return;

  const remainingMs = Math.max(0, 15000 - diagnosticVisibleMs);
  diagnosticVisibleStartedAt = Date.now();
  diagnosticVisibleTimer = window.setTimeout(() => {
    if (document.visibilityState !== 'visible') return;

    diagnosticVisibleMs += Date.now() - diagnosticVisibleStartedAt;
    if (diagnosticVisibleMs < 15000 || diagnosticVisible15sSent) return;

    diagnosticVisible15sSent = true;
    trackGaDiagnosticEvent('ai_visible_15s', {
      visible_seconds: Math.round(diagnosticVisibleMs / 1000),
    });
  }, remainingMs);
}

function pauseVisible15sTimer() {
  stopVisible15sTimer();
  if (diagnosticVisibleStartedAt > 0) {
    diagnosticVisibleMs += Date.now() - diagnosticVisibleStartedAt;
    diagnosticVisibleStartedAt = 0;
  }
}

function initGaDiagnosticTracking() {
  const nextPath = `${window.location.pathname}${window.location.search}`;
  if (diagnosticPath === nextPath) return;

  pauseVisible15sTimer();
  diagnosticPath = nextPath;
  diagnosticInteractionSent = false;
  diagnosticVisible15sSent = false;
  diagnosticVisibleMs = 0;
  diagnosticVisibleStartedAt = 0;
  scheduleVisible15sTimer();
}

function handleDiagnosticInteraction(e: Event) {
  if (diagnosticInteractionSent) return;

  diagnosticInteractionSent = true;
  trackGaDiagnosticEvent('ai_human_interaction', {
    interaction_type: e.type,
  });
}

function handleDiagnosticVisibilityChange() {
  if (document.visibilityState === 'visible') {
    scheduleVisible15sTimer();
  } else {
    pauseVisible15sTimer();
  }
}

function trackEvent(
  itemId: string,
  snapshotDate: string,
  eventType: 'impression' | 'click' | 'click_original',
) {
  const userId = getUserId();
  if (!userId || !itemId || !snapshotDate) return;
  fetch(`${SUPABASE_URL}/rest/v1/user_events`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ item_id: itemId, snapshot_date: snapshotDate, event_type: eventType, user_id: userId }),
  }).catch(() => {});
}

function initImpressionTracking() {
  const cards = document.querySelectorAll<HTMLElement>('[data-track-impression="true"][data-item-id][data-snapshot-date]');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLElement;
        const itemId = el.dataset.itemId!;
        const snapshotDate = el.dataset.snapshotDate!;
        const key = `${itemId}-${snapshotDate}`;
        if (trackedImpressions.has(key)) return;

        setTimeout(() => {
          if (!trackedImpressions.has(key)) {
            trackedImpressions.add(key);
            trackEvent(itemId, snapshotDate, 'impression');
          }
          observer.unobserve(el);
        }, 5000);
      });
    },
    { threshold: 0.5 },
  );

  cards.forEach((card) => observer.observe(card));
}

function initClickOriginalTracking() {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-event="click_original"]');
    if (!el) return;
    const itemId = el.dataset.itemId;
    const snapshotDate = el.dataset.snapshotDate;
    if (itemId && snapshotDate) {
      trackEvent(itemId, snapshotDate, 'click_original');
    }
  });
}

function initClickTracking() {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-event="click_article"]');
    if (!el) return;
    const itemId = el.dataset.itemId;
    const snapshotDate = el.dataset.snapshotDate;
    if (itemId && snapshotDate) {
      trackEvent(itemId, snapshotDate, 'click');
    }
  });

  document.addEventListener('aha:modal-opened', ((e: CustomEvent) => {
    const { item_id, snapshot_date } = e.detail;
    if (item_id && snapshot_date) {
      trackEvent(item_id, snapshot_date, 'click');
    }
  }) as EventListener);
}

document.addEventListener('astro:page-load', () => {
  initGaDiagnosticTracking();
  initImpressionTracking();
  if (!globalListenersAttached) {
    globalListenersAttached = true;
    document.addEventListener('pointerdown', handleDiagnosticInteraction, { passive: true });
    document.addEventListener('touchstart', handleDiagnosticInteraction, { passive: true });
    document.addEventListener('wheel', handleDiagnosticInteraction, { passive: true });
    document.addEventListener('keydown', handleDiagnosticInteraction);
    document.addEventListener('visibilitychange', handleDiagnosticVisibilityChange);
    initClickOriginalTracking();
    initClickTracking();
  }
});
