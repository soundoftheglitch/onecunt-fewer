(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsSafeLinks = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

  function safeHref(value) {
    try {
      const parsed = new URL(String(value || ""), "https://ntforum.net/");
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
    } catch (_error) { return null; }
  }

  function plain(value) {
    return String(value || "").replace(/<[^>]*>/g, "").replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&");
  }

  function bareParts(value) {
    const parts = []; let start = 0;
    for (const match of String(value || "").matchAll(URL_PATTERN)) {
      if (match.index > start) parts.push({ text: value.slice(start, match.index) });
      let visible = match[0]; let suffix = "";
      while (/[.,;:!?\])}]/.test(visible.at(-1) || "")) { suffix = visible.at(-1) + suffix; visible = visible.slice(0, -1); }
      const href = safeHref(visible);
      if (href) parts.push({ text: visible, href }); else parts.push({ text: visible });
      if (suffix) parts.push({ text: suffix });
      start = match.index + match[0].length;
    }
    if (start < value.length) parts.push({ text: value.slice(start) });
    return parts;
  }

  function parts(value) {
    const source = String(value || ""); const output = []; let start = 0;
    for (const match of source.matchAll(ANCHOR)) {
      output.push(...bareParts(plain(source.slice(start, match.index))));
      const href = safeHref(match[1] || match[2] || match[3]); const label = plain(match[4]) || href || "link";
      output.push(href ? { text: label, href } : { text: label });
      start = match.index + match[0].length;
    }
    output.push(...bareParts(plain(source.slice(start))));
    return output.filter(part => part.text).reduce((merged, part) => {
      const previous = merged.at(-1);
      if (!part.href && previous && !previous.href) previous.text += part.text;
      else merged.push(part);
      return merged;
    }, []);
  }

  return { parts, safeHref };
});
