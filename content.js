"use strict";

const FILENAME_PATTERN = /([\u4e00-\u9fffA-Za-z0-9()[\]{}<>【】（）《》\-_. ,，、]{1,160}\.[A-Za-z0-9]{1,10})/g;
let seedTimer = 0;

scheduleSeedCollection();
document.addEventListener("DOMContentLoaded", scheduleSeedCollection, { once: true });
observeDomChanges();

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest("a[href]");
    if (!anchor) {
      return;
    }

    const href = anchor.href;
    const candidates = collectCandidates(anchor);
    if (!href || candidates.length === 0) {
      return;
    }

    chrome.runtime.sendMessage({
      type: "download-clicked",
      url: href,
      pageUrl: location.href,
      pageTitle: document.title,
      candidates
    });
  },
  true
);

function collectCandidates(anchor) {
  const candidates = [];

  pushCandidate(candidates, anchor.getAttribute("download"), "download", 100);
  pushCandidate(candidates, parseSudyTitle(anchor.getAttribute("sudyfile-attr")), "sudyfile-attr", 95);
  pushCandidate(candidates, anchor.getAttribute("title"), "anchor-title", 80);
  pushCandidate(candidates, anchor.getAttribute("aria-label"), "aria-label", 75);
  pushCandidate(candidates, anchor.textContent, "anchor-text", 70);
  pushCandidate(candidates, anchor.querySelector("img")?.getAttribute("alt"), "image-alt", 65);

  const nearbyTexts = [
    anchor.previousElementSibling?.textContent,
    anchor.nextElementSibling?.textContent,
    anchor.parentElement?.textContent
  ];
  for (const text of nearbyTexts) {
    pushExtractedCandidates(candidates, text, "nearby-text", 60);
  }

  const containers = [
    anchor.closest("li"),
    anchor.closest("tr"),
    anchor.closest("p"),
    anchor.closest("td"),
    anchor.closest(".wp_articlecontent"),
    anchor.closest(".Article_Content")
  ].filter(Boolean);
  for (const container of containers) {
    pushExtractedCandidates(candidates, container.textContent, "container-text", 55);
  }

  pushCandidate(candidates, document.title, "page-title", 25);
  return dedupeCandidates(candidates).slice(0, 12);
}

function pushCandidate(candidates, rawValue, source, score) {
  const normalized = normalizeCandidate(rawValue);
  if (!normalized) {
    return;
  }
  candidates.push({ value: normalized, source, score });
}

function pushExtractedCandidates(candidates, rawText, source, score) {
  const normalized = normalizeCandidate(rawText);
  if (!normalized) {
    return;
  }

  const matches = normalized.matchAll(FILENAME_PATTERN);
  let found = false;
  for (const match of matches) {
    found = true;
    pushCandidate(candidates, match[1], source, score);
  }

  if (!found && normalized.length <= 80) {
    pushCandidate(candidates, normalized, source, score - 20);
  }
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate?.value) {
      return false;
    }
    const key = candidate.value.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeCandidate(value) {
  if (!value) {
    return null;
  }
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/[<>"]/g, "")
    .replace(/^[\s\d一二三四五六七八九十]+[.、）)]\s*/, "")
    .trim();
  return cleaned || null;
}

function parseSudyTitle(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const titleMatch = raw.match(/['"]title['"]\s*:\s*['"]([^'"]+)['"]/i);
  if (titleMatch) {
    return titleMatch[1];
  }

  return null;
}

function observeDomChanges() {
  const observer = new MutationObserver(() => {
    scheduleSeedCollection();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function scheduleSeedCollection() {
  if (seedTimer) {
    window.clearTimeout(seedTimer);
  }

  seedTimer = window.setTimeout(() => {
    seedTimer = 0;
    sendSeedCandidates();
  }, 200);
}

function sendSeedCandidates() {
  const anchors = document.querySelectorAll("a[href]");
  const urlMap = new Map();

  for (const anchor of anchors) {
    if (!(anchor instanceof HTMLAnchorElement)) {
      continue;
    }

    const href = anchor.href;
    if (!href) {
      continue;
    }

    const candidates = collectCandidates(anchor);
    if (candidates.length === 0) {
      continue;
    }

    if (!urlMap.has(href)) {
      urlMap.set(href, candidates);
    }

    if (urlMap.size >= 300) {
      break;
    }
  }

  const items = [];
  for (const [url, candidates] of urlMap.entries()) {
    items.push({ url, candidates });
  }

  if (items.length === 0) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "seed-candidates",
    pageUrl: location.href,
    pageTitle: document.title,
    items
  });
}
