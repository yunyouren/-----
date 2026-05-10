"use strict";

const SETTINGS_KEY = "settings";
const MODE_ALL = "all";
const MODE_WHITELIST = "whitelist";
const MODE_BLACKLIST = "blacklist";
const DEFAULT_SETTINGS = {
  enabled: true,
  mode: MODE_ALL,
  whitelist: [],
  blacklist: []
};

const enabledEl = document.getElementById("enabled");
const modeEl = document.getElementById("mode");
const siteEl = document.getElementById("site");
const statusEl = document.getElementById("status");
const addCurrentSiteBtn = document.getElementById("addCurrentSite");
const openOptionsBtn = document.getElementById("openOptions");

let currentHost = "";

void init();

applyI18n();

enabledEl.addEventListener("change", () => {
  void updateEnabled(enabledEl.checked);
});

openOptionsBtn.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

addCurrentSiteBtn.addEventListener("click", () => {
  void addCurrentSiteToWhitelist();
});

function applyI18n() {
  const elements = document.querySelectorAll("[data-i18n]");
  for (const el of elements) {
    const key = el.getAttribute("data-i18n");
    const message = chrome.i18n.getMessage(key);
    if (message) {
      el.textContent = message;
    }
  }
}

function i18n(key, substitutions) {
  if (substitutions) {
    return chrome.i18n.getMessage(key, substitutions);
  }
  return chrome.i18n.getMessage(key);
}

async function init() {
  const [settingsData, tab] = await Promise.all([chrome.storage.sync.get(SETTINGS_KEY), getCurrentTab()]);
  const settings = mergeSettings(settingsData[SETTINGS_KEY]);
  currentHost = extractHost(tab?.url);

  enabledEl.checked = settings.enabled;
  modeEl.textContent = renderModeText(settings);
  siteEl.textContent = currentHost
    ? i18n("current_site", currentHost)
    : i18n("current_site_unavailable");
  addCurrentSiteBtn.disabled = !currentHost;
}

async function updateEnabled(enabled) {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = mergeSettings(data[SETTINGS_KEY]);
  settings.enabled = Boolean(enabled);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

async function addCurrentSiteToWhitelist() {
  if (!currentHost) {
    statusEl.textContent = i18n("cannot_identify_site");
    return;
  }

  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = mergeSettings(data[SETTINGS_KEY]);
  const set = new Set(settings.whitelist.map(normalizeDomainRule).filter(Boolean));

  if (set.has(currentHost)) {
    statusEl.textContent = i18n("already_in_whitelist");
    return;
  }

  set.add(currentHost);
  settings.whitelist = Array.from(set);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  statusEl.textContent = i18n("added_to_whitelist", currentHost);
}

function renderModeText(settings) {
  if (settings.mode === MODE_WHITELIST) {
    return i18n("mode_whitelist", String(settings.whitelist.length));
  }
  if (settings.mode === MODE_BLACKLIST) {
    return i18n("mode_blacklist", String(settings.blacklist.length));
  }
  return i18n("mode_all_sites");
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function extractHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host || "";
  } catch {
    return "";
  }
}

function mergeSettings(value) {
  const base = { ...DEFAULT_SETTINGS };
  if (!value || typeof value !== "object") {
    return base;
  }
  base.enabled = Boolean(value.enabled);
  base.mode = normalizeMode(value.mode, value.whitelistMode);
  base.whitelist = Array.isArray(value.whitelist) ? value.whitelist : [];
  base.blacklist = Array.isArray(value.blacklist) ? value.blacklist : [];
  return base;
}

function normalizeMode(mode, legacyWhitelistMode) {
  if (mode === MODE_ALL || mode === MODE_WHITELIST || mode === MODE_BLACKLIST) {
    return mode;
  }
  return legacyWhitelistMode ? MODE_WHITELIST : MODE_ALL;
}

function normalizeDomainRule(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  let rule = value.trim().toLowerCase();
  if (!rule) {
    return "";
  }
  rule = rule.replace(/^https?:\/\//, "");
  rule = rule.replace(/\/.*$/, "");
  return rule;
}