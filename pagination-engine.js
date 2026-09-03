(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) module.exports = api;
  root.NtForumPagination = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function integer(value) {
    const text = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : null;
  }

  function clampPage(value, totalPages) {
    const total = Math.max(1, integer(totalPages) || 1);
    const page = integer(value);
    if (page === null || page < 1 || page > total) return null;
    return page;
  }

  function formatPage(value) {
    const page = Math.max(1, integer(value) || 1);
    return page < 10 ? `0${page}` : String(page);
  }

  function routeOptions(options) {
    return { mode: options && options.mode === "hash-params" ? "hash-params" : "classic",
      pageKey: String(options && options.pageKey || "page") };
  }

  function pageFromUrl(url, totalPages, options) {
    const parsed = new URL(url, "https://ntforum.net/");
    const route = routeOptions(options);
    let value = 1;
    if (route.mode === "hash-params") {
      value = new URLSearchParams(parsed.hash.replace(/^#/, "")).get(route.pageKey) || 1;
    } else {
      const match = parsed.hash.match(/^#page=(\d+)$/);
      value = match ? match[1] : 1;
    }
    return clampPage(value, totalPages) || 1;
  }

  function urlForPage(url, page, options) {
    const parsed = new URL(url, "https://ntforum.net/");
    const route = routeOptions(options);
    const target = integer(page);
    if (target === null || target < 1) throw new RangeError("Page must be a positive integer.");
    if (route.mode === "hash-params") {
      const params = new URLSearchParams(parsed.hash.replace(/^#/, ""));
      if (target === 1) params.delete(route.pageKey); else params.set(route.pageKey, String(target));
      parsed.hash = params.toString();
    } else parsed.hash = target > 1 ? `page=${target}` : "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  function createPageState(options) {
    const route = options.route || {};
    const historyApi = options.history || (typeof history !== "undefined" ? history : null);
    const locationApi = options.location || (typeof location !== "undefined" ? location : null);
    function pages() { return Math.max(1, integer(options.pages()) || 1); }
    function page() { return clampPage(options.page(), pages()) || 1; }
    function url(target, source) {
      return urlForPage(source || (locationApi && locationApi.href) || "https://ntforum.net/", target, route);
    }
    function navigate(value, navigation = options.navigation || "push") {
      const target = clampPage(value, pages());
      if (target === null) return false;
      if (target !== page()) options.onPage(target);
      if (navigation !== "none" && historyApi) {
        const method = navigation === "replace" ? "replaceState" : "pushState";
        historyApi[method]({ ...(options.historyState || {}), fewercuntsPage: target }, "", url(target));
      }
      return true;
    }
    function restore(source) {
      return navigate(pageFromUrl(source || (locationApi && locationApi.href), pages(), route), "none");
    }
    return { page, pages, navigate, restore, url };
  }

  const ROWS_STORAGE_KEY = "fewercunts.rows-per-page";
  const ROWS_EVENT = "fewercunts:rows-change";
  const MODE_STORAGE_KEY = "fewercunts.pagination-mode";
  const MODE_EVENT = "fewercunts:pagination-mode-change";
  const MANUAL_ROWS = Object.freeze([5, 10, 15, 20, 25, 50]);

  function normaliseRows(value) {
    if (value === "auto" || value == null || value === "") return "auto";
    const rows = integer(value);
    return MANUAL_ROWS.includes(rows) ? rows : "auto";
  }

  function pageForAnchor(page, oldRows, newRows) {
    const current = Math.max(1, integer(page) || 1);
    const before = Math.max(1, integer(oldRows) || 1);
    const after = Math.max(1, integer(newRows) || 1);
    return Math.floor(((current - 1) * before) / after) + 1;
  }

  function fitRows(available, rowHeights, maximum = 25) {
    const space = Math.max(0, Number(available) || 0);
    const heights = Array.from(rowHeights || []).map(Number).filter(value => value > 0);
    if (!heights.length) return Math.max(1, Math.min(25, integer(maximum) || 25));
    const sorted = [...heights].sort((a, b) => a - b);
    const representative = sorted[Math.floor(sorted.length / 2)];
    const limit = integer(maximum) || 25;
    let used = 0; let count = 0;
    while (count < limit) {
      const height = count < heights.length ? heights[count] : representative;
      if (used + height > space) break;
      used += height; count += 1;
    }
    return Math.max(1, count);
  }

  function storedRows() {
    try { return normaliseRows(localStorage.getItem(ROWS_STORAGE_KEY)); }
    catch (_error) { return "auto"; }
  }

  function storeRows(value) {
    const preference = normaliseRows(value);
    try { localStorage.setItem(ROWS_STORAGE_KEY, String(preference)); } catch (_error) {}
    document.dispatchEvent(new CustomEvent(ROWS_EVENT, { detail: String(preference) }));
    return preference;
  }

  function normaliseMode(_value) { return "pages"; }

  function storedMode() {
    try { return normaliseMode(localStorage.getItem(MODE_STORAGE_KEY)); }
    catch (_error) { return "pages"; }
  }

  function storeMode(value) {
    const mode = normaliseMode(value);
    try { localStorage.setItem(MODE_STORAGE_KEY, mode); } catch (_error) {}
    document.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: mode }));
    return mode;
  }

  function createRows(options) {
    const wrapper = document.createElement("div");
    wrapper.className = "fewercunts-rows-control";
    const label = document.createElement("label");
    label.append(document.createTextNode("Rows "));
    const select = document.createElement("select");
    select.className = "fewercunts-rows-select";
    select.setAttribute("aria-label", options.label || "Rows per page");
    for (const [value, text] of [["auto", "Auto"], ...MANUAL_ROWS.map(value => [String(value), String(value)])]) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; select.appendChild(option);
    }
    label.appendChild(select);
    const status = document.createElement("span");
    status.className = "fewercunts-rows-status"; status.setAttribute("aria-live", "polite");
    wrapper.append(label, status);
    let preference = storedRows();
    let effective = Math.max(1, integer(options.rows()) || 25);
    let timer = null;
    let applying = false;

    function updateStatus() {
      select.value = String(preference);
      status.textContent = preference === "auto" ? ` (${effective})` : "";
    }
    function measure() {
      if (preference !== "auto" || applying || !wrapper.isConnected) return;
      const pager = Array.from(document.querySelectorAll(".fewercunts-pagination"))
        .find(node => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden");
      const rows = Array.from((options.container || document).querySelectorAll(options.rowSelector || ".thread-header"))
        .filter(node => !node.hidden && node.getClientRects().length);
      if (!pager || !rows.length) return;
      const first = rows[0].getBoundingClientRect();
      const available = pager.getBoundingClientRect().top - first.top - 1;
      const next = fitRows(available, rows.slice(0, 50).map(node => node.getBoundingClientRect().height), options.maximum || 50);
      if (next === effective) { updateStatus(); return; }
      const old = effective; effective = next; updateStatus(); applying = true;
      Promise.resolve(options.onRows(next, old, "auto")).finally(() => { applying = false; schedule(); });
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(measure, options.debounce || 140); }
    function applyPreference(value, announce) {
      preference = normaliseRows(value);
      if (announce) storeRows(preference);
      if (preference === "auto") { updateStatus(); schedule(); return; }
      const next = preference;
      const old = effective; effective = next; updateStatus();
      if (next !== old) options.onRows(next, old, "manual");
    }
    select.addEventListener("change", () => applyPreference(select.value, true));
    const externalChange = event => { if (String(event.detail) !== String(preference)) applyPreference(event.detail, false); };
    document.addEventListener(ROWS_EVENT, externalChange);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("load", schedule, { once: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (observer) { observer.observe(document.documentElement); observer.observe(wrapper); }
    applyPreference(preference, false);
    updateStatus(); schedule();
    return { element: wrapper, schedule, rows: () => effective, preference: () => preference,
      destroy() { clearTimeout(timer); document.removeEventListener(ROWS_EVENT, externalChange); window.removeEventListener("resize", schedule); if (observer) observer.disconnect(); } };
  }

  function create(options) {
    const state = options.state || { page: options.page, pages: options.pages, navigate: options.onPage };
    const nav = document.createElement("nav");
    nav.className = "fewercunts-pagination";
    nav.setAttribute("aria-label", options.label || "Pagination");
    const pageControls = document.createElement("span");
    pageControls.className = "fewercunts-page-controls";
    const announcement = document.createElement("span");
    announcement.className = "fewercunts-pagination-status";
    announcement.setAttribute("role", "status"); announcement.setAttribute("aria-live", "polite");
    const controls = {};
    function button(parent, name, text, compact, page) {
      const node = document.createElement("button");
      node.type = "button"; node.className = "fewercunts-page-control link-text";
      node.textContent = text; node.dataset.compactLabel = compact;
      node.setAttribute("aria-label", `${name} page`);
      node.addEventListener("click", () => {
        const target = page();
        if (state.navigate(target)) announcement.textContent = `Loading page ${formatPage(target)} of ${formatPage(state.pages())}`;
      });
      parent.appendChild(node); controls[name.toLowerCase()] = node;
    }
    button(pageControls, "First", "First", "First", () => 1);
    button(pageControls, "Previous", "‹ Previous", "Prev", () => state.page() - 1);
    const label = document.createElement("label");
    label.className = "fewercunts-pagination-page";
    label.append(document.createTextNode("Page "));
    const input = document.createElement("input");
    input.className = "fewercunts-page-input"; input.type = "text";
    input.inputMode = "numeric"; input.autocomplete = "off";
    input.setAttribute("aria-label", "Page number"); label.appendChild(input);
    const total = document.createElement("span");
    total.className = "fewercunts-page-total";
    label.append(document.createTextNode(" of "), total); pageControls.appendChild(label);
    button(pageControls, "Next", "Next ›", "Next", () => state.page() + 1);
    button(pageControls, "Last", "Last", "Last", () => state.pages());
    nav.append(pageControls, announcement);
    function sync() {
      const pages = Math.max(1, integer(state.pages()) || 1);
      const page = clampPage(state.page(), pages) || 1;
      input.value = formatPage(page); total.textContent = formatPage(pages);
      input.removeAttribute("aria-invalid"); input.setCustomValidity("");
      input.setAttribute("aria-valuemin", "1"); input.setAttribute("aria-valuemax", String(pages));
      input.setAttribute("aria-valuenow", String(page));
      controls.first.disabled = controls.previous.disabled = page <= 1;
      controls.next.disabled = controls.last.disabled = page >= pages;
    }
    function submit() {
      const page = clampPage(input.value, state.pages());
      if (page === null) {
        input.setAttribute("aria-invalid", "true");
        const message = `Enter a page from 1 to ${state.pages()}.`;
        input.setCustomValidity(message); announcement.textContent = message; input.focus(); return;
      }
      input.removeAttribute("aria-invalid"); input.setCustomValidity(""); state.navigate(page);
    }
    function keyboardPage(event) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
          || !["ArrowLeft", "ArrowRight"].includes(event.key) || !nav.getClientRects().length) return;
      const target = event.target;
      if (target && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))) return;
      const next = state.page() + (event.key === "ArrowRight" ? 1 : -1);
      if (clampPage(next, state.pages()) === null) return;
      event.preventDefault(); state.navigate(next);
      announcement.textContent = `Loading page ${formatPage(next)} of ${formatPage(state.pages())}`;
    }
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); submit(); } });
    document.addEventListener("keydown", keyboardPage);
    input.addEventListener("blur", sync); sync();
    return { element: nav, sync, input, mode: () => "pages",
      destroy() { document.removeEventListener("keydown", keyboardPage); } };
  }

  return { clampPage, formatPage, pageFromUrl, urlForPage, createPageState, create, normaliseRows, pageForAnchor, fitRows,
    storedRows, storeRows, createRows, normaliseMode, storedMode, storeMode,
    MANUAL_ROWS, ROWS_EVENT, MODE_EVENT };
});
