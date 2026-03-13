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
const modeEls = document.querySelectorAll('input[name="mode"]');
const whitelistEl = document.getElementById("whitelist");
const blacklistEl = document.getElementById("blacklist");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

void loadSettings();
saveBtn.addEventListener("click", () => {
  void saveSettings();
});

async function loadSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = mergeSettings(data[SETTINGS_KEY]);

  enabledEl.checked = settings.enabled;
  setSelectedMode(settings.mode);
  whitelistEl.value = settings.whitelist.join("\n");
  blacklistEl.value = settings.blacklist.join("\n");
}

async function saveSettings() {
  const settings = {
    enabled: enabledEl.checked,
    mode: getSelectedMode(),
    whitelist: parseDomainList(whitelistEl.value),
    blacklist: parseDomainList(blacklistEl.value)
  };

  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  statusEl.textContent = "已保存";
  window.setTimeout(() => {
    statusEl.textContent = "";
  }, 1200);
}

function parseDomainList(text) {
  return text
    .split(/\r?\n/)
    .map(normalizeDomainRule)
    .filter(Boolean);
}

function getSelectedMode() {
  const checked = Array.from(modeEls).find((node) => node.checked)?.value;
  if (checked === MODE_WHITELIST || checked === MODE_BLACKLIST || checked === MODE_ALL) {
    return checked;
  }
  return MODE_ALL;
}

function setSelectedMode(mode) {
  const safeMode = mode === MODE_WHITELIST || mode === MODE_BLACKLIST ? mode : MODE_ALL;
  for (const node of modeEls) {
    node.checked = node.value === safeMode;
  }
}

function mergeSettings(value) {
  const base = { ...DEFAULT_SETTINGS };
  if (!value || typeof value !== "object") {
    return base;
  }

  base.enabled = Boolean(value.enabled);
  base.mode = normalizeMode(value.mode, value.whitelistMode);
  base.whitelist = Array.isArray(value.whitelist) ? value.whitelist.map(normalizeDomainRule).filter(Boolean) : [];
  base.blacklist = Array.isArray(value.blacklist) ? value.blacklist.map(normalizeDomainRule).filter(Boolean) : [];
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
