(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsUiUnloved = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function pageNumber(value) {
    const page = Number(value);
    return Number.isSafeInteger(page) && page > 0 ? page : 1;
  }

  function create(context) {
    const { addPagination, addRows, authorControl, closeSearch, currentViewState, element, history,
      nativeThreads, openResult, results, routeUrl, send, showStatus, statusPanel, stopProgress } = context;
    async function show(page = 1) {
      page = pageNumber(page); closeSearch(); stopProgress(); showStatus("Loading unloved threads…", "loading");
      const pageSize = context.pageSize();
      const response = await send({ type: "fewercunts-search:unloved", offset: (page - 1) * pageSize, limit: pageSize });
      const totalPages = Math.max(1, Math.ceil(response.total / pageSize));
      if (page > totalPages) {
        history.replaceState({}, "", routeUrl(currentViewState("unloved", { page: 1 })));
        return show(1);
      }
      nativeThreads.hidden = true; results.hidden = false; results.dataset.state = response.total ? "results" : "empty";
      results.setAttribute("aria-busy", "false");
      const children = [statusPanel(response.total ? "results" : "empty",
        `${response.total} indexed unloved thread${response.total === 1 ? "" : "s"}, oldest first`)];
      addRows(children, page, "Rows per page for Unloved", (target, replace) => {
        if (replace) history.replaceState({}, "", routeUrl(currentViewState("unloved", { page: target })));
        return show(target);
      });
      const header = element("div", "all-threads-header thread-underline-gold row fewercunts-unloved-header");
      for (const [classes, label] of [["col-xs-1 no-wrap", "Size"], ["col-xs-6 no-wrap", "Subject"],
        ["col-xs-2 no-wrap", "From"], ["col-xs-2 col-xs-offset-1 no-wrap", "When"]]) {
        header.appendChild(element("div", classes, label));
      }
      children.push(header);
      for (const item of response.items) {
        const row = element("div", "thread-header thread-underline row fewercunts-unloved-thread");
        const size = element("div", "col-xs-1 no-wrap", "1"); const subject = element("div", "col-xs-6");
        const title = element("a", "link-text", item.title || "Untitled post"); title.href = item.canonicalUrl;
        title.addEventListener("click", event => { event.preventDefault();
          openResult(item, false).catch(error => showStatus(`Visit error: ${error.message}`, "error")); });
        subject.appendChild(title); const from = element("div", "col-xs-2"); from.appendChild(authorControl(item.username));
        const when = element("div", "col-xs-2 col-xs-offset-1", new Date(item.createdUtc).toLocaleDateString());
        row.append(size, subject, from, when); children.push(row);
      }
      addPagination(children, response.total, page, "Unloved pagination", { view: "unloved" }, target => show(target));
      results.replaceChildren(...children);
    }
    return { show };
  }

  return { create, pageNumber };
});
