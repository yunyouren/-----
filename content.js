"use strict";

const FILENAME_PATTERN = /([\u4e00-\u9fffA-Za-z0-9()（）【】\[\]《》\-_. ,，、]{1,160}\.[A-Za-z0-9]{1,10})/g;

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
  pushCandidate(candidates, anchor.getAttribute("title"), "anchor-title", 80);
  pushCandidate(candidates, anchor.getAttribute("aria-label"), "aria-label", 75);
  pushCandidate(candidates, anchor.textContent, "anchor-text", 70);
  pushCandidate(candidates, anchor.querySelector("img")?.getAttribute("alt"), "image-alt", 65);

  const directContext = [
    anchor.previousElementSibling?.textContent,
    anchor.nextElementSibling?.textContent,
    anchor.parentElement?.textContent
  ];

  for (const text of directContext) {
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
