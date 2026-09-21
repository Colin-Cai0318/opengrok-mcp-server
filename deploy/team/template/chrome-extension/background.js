importScripts("generated-config.js");
const CFG = globalThis.OPENGROK_SYNC_CONFIG;
const UPDATE_URL = `${CFG.helperUrl}/update`;
const HEALTH_URL = `${CFG.helperUrl}/health`;
const ALARM_NAME = "opengrok-cookie-sync";
const ALARM_PERIOD_MINUTES = 5;
const TARGETS = {
  OPENGROK_COOKIE_V: { label: "Android V", url: "__OPENGROK_V_URL__" },
  OPENGROK_COOKIE_W: { label: "Android W", url: "__OPENGROK_W_URL__" },
  OPENGROK_COOKIE_X: { label: "Android X / A17", url: "__OPENGROK_X_URL__" }
};

async function ensureAlarm() {
  const current = await chrome.alarms.get(ALARM_NAME);
  if (!current) chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
}

async function buildCookieHeader(url) {
  const cookies = await chrome.cookies.getAll({ url });
  if (!cookies.length) throw new Error(`No cookies found for ${url}`);
  cookies.sort((a, b) => (b.path?.length || 0) - (a.path?.length || 0));
  return { count: cookies.length, header: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

async function helperHealth() {
  const response = await fetch(HEALTH_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Helper HTTP ${response.status}`);
  return response.json();
}

async function syncAll({ quiet = false } = {}) {
  const available = {};
  const result = {};
  for (const [envName, target] of Object.entries(TARGETS)) {
    try {
      const cookie = await buildCookieHeader(target.url);
      available[envName] = cookie.header;
      result[envName] = { ok: true, count: cookie.count, label: target.label };
    } catch (error) {
      result[envName] = { ok: false, count: 0, label: target.label, error: String(error?.message || error) };
    }
  }
  if (!Object.keys(available).length) {
    if (quiet) return { ok: false, skipped: true, reason: "no-cookies", targets: result };
    throw new Error("No OpenGrok cookies available. Open the three login pages first.");
  }
  const response = await fetch(UPDATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OpenGrok-Sync-Token": CFG.helperToken },
    body: JSON.stringify({ cookies: available })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error || `Helper HTTP ${response.status}`);
  return { ok: true, changed: Boolean(body.changed), targets: result };
}

function cookieDomainAffectsTarget(cookieDomain, targetUrl) {
  const domain = String(cookieDomain || "").replace(/^\./, "").toLowerCase();
  const hostname = new URL(targetUrl).hostname.toLowerCase();
  return Boolean(domain) && (hostname === domain || hostname.endsWith(`.${domain}`));
}

let debounceTimer = null;
chrome.cookies.onChanged.addListener((changeInfo) => {
  const relevant = Object.values(TARGETS).some((target) => cookieDomainAffectsTarget(changeInfo.cookie.domain, target.url));
  if (!relevant) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncAll({ quiet: true }).catch(() => {}), 1500);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) syncAll({ quiet: true }).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => ensureAlarm().then(() => syncAll({ quiet: true })).catch(() => {}));
chrome.runtime.onStartup.addListener(() => ensureAlarm().then(() => syncAll({ quiet: true })).catch(() => {}));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "syncNow") {
    syncAll().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (message?.type === "health") {
    helperHealth().then((data) => sendResponse({ ok: true, data })).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (message?.type === "openLogins") {
    Promise.all(Object.values(TARGETS).map((t) => chrome.tabs.create({ url: t.url })))
      .then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  return false;
});
ensureAlarm().catch(() => {});
