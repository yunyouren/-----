"use strict";

const MAX_CLICK_RECORDS = 200;
const MAX_CANDIDATES_PER_CLICK = 12;
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

const clickRecords = [];
const headerFilenameByUrl = new Map();
const seededRecordsByUrl = new Map();
let cachedSettings = { ...DEFAULT_SETTINGS };

void bootstrapSettings();

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[SETTINGS_KEY]) {
    return;
  }
  cachedSettings = mergeSettings(changes[SETTINGS_KEY].newValue);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "seed-candidates") {
    const items = Array.isArray(message.items) ? message.items : [];
    for (const item of items) {
      const url = normalizeUrl(item?.url);
      const candidates = sanitizeCandidates(item?.candidates || []);
      if (!url || candidates.length === 0) {
        continue;
      }
      seededRecordsByUrl.set(url, {
        url,
        pageUrl: normalizeUrl(message.pageUrl),
        pageTitle: normalizeText(message.pageTitle),
        candidates,
        timestamp: Date.now()
      });
    }
    pruneSeededRecords();
    sendResponse({ ok: true, count: items.length });
    return false;
  }

  if (message?.type !== "download-clicked") {
    return false;
  }

  if (!isUrlAllowedBySettings(message.pageUrl)) {
    sendResponse({ ok: false, reason: "site-not-allowed" });
    return false;
  }

  const normalizedUrl = normalizeUrl(message.url);
  const candidates = sanitizeCandidates(message.candidates || []);
  if (!normalizedUrl || candidates.length === 0) {
    sendResponse({ ok: false });
    return false;
  }

  clickRecords.push({
    url: normalizedUrl,
    pageUrl: normalizeUrl(message.pageUrl),
    pageTitle: normalizeText(message.pageTitle),
    candidates,
    timestamp: Date.now()
  });

  if (clickRecords.length > MAX_CLICK_RECORDS) {
    clickRecords.splice(0, clickRecords.length - MAX_CLICK_RECORDS);
  }

  sendResponse({ ok: true });
  return false;
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isUrlAllowedBySettings(details.initiator || details.url)) {
      return;
    }

    const filename = getFilenameFromHeaders(details.responseHeaders || []);
    const url = normalizeUrl(details.url);
    if (!filename || !url) {
      return;
    }
    headerFilenameByUrl.set(url, filename);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const gateUrl = downloadItem.referrer || downloadItem.finalUrl || downloadItem.url;
  if (!isUrlAllowedBySettings(gateUrl)) {
    suggest();
    return;
  }

  const currentName = getLeafName(downloadItem.filename);
  if (!isProbablyHashedFilename(currentName)) {
    suggest();
    return;
  }

  const candidate = pickCandidateFilename(downloadItem);
  if (!candidate) {
    suggest();
    return;
  }

  suggest({ filename: candidate, conflictAction: "uniquify" });
});

function pickCandidateFilename(downloadItem) {
  const urlCandidates = [normalizeUrl(downloadItem.finalUrl), normalizeUrl(downloadItem.url)].filter(Boolean);

  for (const url of urlCandidates) {
    const headerFilename = headerFilenameByUrl.get(url);
    if (headerFilename) {
      return headerFilename;
    }
  }

  for (const url of urlCandidates) {
    const seeded = seededRecordsByUrl.get(url);
    if (!seeded) {
      continue;
    }
    const extension = inferExtension(downloadItem);
    const selected = chooseBestCandidate(seeded.candidates, extension);
    if (selected) {
      return selected;
    }
  }

  const matchedClick = findBestClickRecord(downloadItem);
  if (!matchedClick) {
    return null;
  }

  const extension = inferExtension(downloadItem);
  const selectedFromCandidates = chooseBestCandidate(matchedClick.candidates, extension);
  if (selectedFromCandidates) {
    return selectedFromCandidates;
  }

  if (matchedClick.pageTitle && extension) {
    return sanitizeFilename(`${matchedClick.pageTitle}${extension}`);
  }
  return null;
}

function findBestClickRecord(downloadItem) {
  const normalizedFinalUrl = normalizeUrl(downloadItem.finalUrl);
  const normalizedUrl = normalizeUrl(downloadItem.url);
  const normalizedReferrer = normalizeUrl(downloadItem.referrer);
  const now = Date.now();

  for (let index = clickRecords.length - 1; index >= 0; index -= 1) {
    const record = clickRecords[index];
    if (now - record.timestamp > 5 * 60 * 1000) {
      continue;
    }

    if (record.url && (record.url === normalizedFinalUrl || record.url === normalizedUrl)) {
      return record;
    }

    if (
      normalizedReferrer &&
      record.pageUrl &&
      record.pageUrl === normalizedReferrer &&
      samePath(record.url, normalizedFinalUrl || normalizedUrl)
    ) {
      return record;
    }
  }

  return null;
}

function chooseBestCandidate(candidates, extension) {
  let bestScore = -1;
  let bestFilename = null;

  for (const candidate of candidates) {
    const scored = normalizeCandidateToFilename(candidate, extension);
    if (!scored) {
      continue;
    }
    if (scored.score > bestScore) {
      bestScore = scored.score;
      bestFilename = scored.filename;
    }
  }

  return bestFilename;
}

function normalizeCandidateToFilename(candidate, extension) {
  const value = normalizeText(candidate?.value);
  if (!value) {
    return null;
  }

  let filename = null;
  let score = Number(candidate.score || 0);

  if (looksLikeFilename(value)) {
    filename = sanitizeFilename(value);
    score += 100;
  } else if (extension && !looksGenericLabel(value)) {
    filename = sanitizeFilename(`${stripTrailingPunctuation(value)}${extension}`);
    score += 40;
  }

  if (!filename) {
    return null;
  }
  if (extension && !filename.toLowerCase().endsWith(extension.toLowerCase())) {
    return null;
  }
  if (looksGenericLabel(filename)) {
    return null;
  }

  return { filename, score };
}

function sanitizeCandidates(rawCandidates) {
  const seen = new Set();
  const normalized = [];

  for (const rawCandidate of rawCandidates) {
    const value = normalizeText(rawCandidate?.value);
    if (!value) {
      continue;
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      value,
      source: rawCandidate?.source || "unknown",
      score: Number(rawCandidate?.score || 0)
    });
  }

  return normalized.slice(0, MAX_CANDIDATES_PER_CLICK);
}

function getFilenameFromHeaders(headers) {
  const contentDisposition = headers.find((header) => header?.name?.toLowerCase() === "content-disposition")?.value;
  if (!contentDisposition) {
    return null;
  }

  const filenameStarMatch = contentDisposition.match(/filename\*\s*=\s*([^;]+)/i);
  if (filenameStarMatch) {
    const encodedValue = filenameStarMatch[1].trim().replace(/^UTF-8''/i, "");
    try {
      return sanitizeFilename(decodeURIComponent(encodedValue));
    } catch {
      return sanitizeFilename(encodedValue);
    }
  }

  const filenameMatch = contentDisposition.match(/filename\s*=\s*("?)([^";]+)\1/i);
  return filenameMatch ? sanitizeFilename(filenameMatch[2]) : null;
}

function inferExtension(downloadItem) {
  const sources = [
    getLeafName(downloadItem.filename),
    getLeafNameFromUrl(downloadItem.finalUrl),
    getLeafNameFromUrl(downloadItem.url)
  ].filter(Boolean);

  for (const source of sources) {
    const match = source.match(/(\.[A-Za-z0-9]{1,10})$/);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function getLeafNameFromUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const pathname = new URL(value).pathname;
    return pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return "";
  }
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function samePath(left, right) {
  if (!left || !right) {
    return false;
  }
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.origin === rightUrl.origin && leftUrl.pathname === rightUrl.pathname;
  } catch {
    return false;
  }
}

function sanitizeFilename(filename) {
  if (!filename) {
    return null;
  }
  const cleaned = filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return cleaned || null;
}

function normalizeText(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/\s+/g, " ").replace(/[：:]\s*$/, "").trim();
  return cleaned || null;
}

function stripTrailingPunctuation(value) {
  return value.replace(/[：:,.，。;；、\s]+$/g, "").trim();
}

function getLeafName(path) {
  if (!path) {
    return "";
  }
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1];
}

function looksLikeFilename(value) {
  return /[.][A-Za-z0-9]{1,10}$/.test(value);
}

function looksGenericLabel(value) {
  return /^(点击下载|下载|附件|查看|更多|详见|打开|进入|链接|Download|Downloads|Click here|View|More|Open|Link|Attachment)$/i.test(value);
}

function isProbablyHashedFilename(filename) {
  const dotIndex = filename.lastIndexOf(".");
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  if (stem.length < 16 || /\s/.test(stem)) {
    return false;
  }

  const hexLike = /^[a-f0-9]{16,}$/i.test(stem);
  const uuidLike = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(stem);
  const slugLike = /^[a-z0-9_-]{20,}$/i.test(stem) && !/[aeiou\u4e00-\u9fff]{4,}/i.test(stem);
  return hexLike || uuidLike || slugLike;
}

async function bootstrapSettings() {
  await ensureSettings();
}

async function ensureSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  const merged = mergeSettings(data[SETTINGS_KEY]);
  cachedSettings = merged;
  if (!data[SETTINGS_KEY] || JSON.stringify(merged) !== JSON.stringify(data[SETTINGS_KEY])) {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: merged });
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

function isUrlAllowedBySettings(url) {
  if (!cachedSettings.enabled) {
    return false;
  }

  const host = extractHost(url);
  if (!host) {
    return cachedSettings.mode === MODE_ALL;
  }

  if (cachedSettings.mode === MODE_WHITELIST) {
    return cachedSettings.whitelist.some((rule) => domainMatches(host, rule));
  }

  if (cachedSettings.mode === MODE_BLACKLIST) {
    return !cachedSettings.blacklist.some((rule) => domainMatches(host, rule));
  }

  return true;
}

function extractHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function domainMatches(host, rule) {
  if (!host || !rule) {
    return false;
  }
  if (rule.startsWith("*.")) {
    const base = rule.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === rule || host.endsWith(`.${rule}`);
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

function pruneSeededRecords() {
  const now = Date.now();
  for (const [url, record] of seededRecordsByUrl.entries()) {
    if (now - record.timestamp > 15 * 60 * 1000) {
      seededRecordsByUrl.delete(url);
    }
  }
}