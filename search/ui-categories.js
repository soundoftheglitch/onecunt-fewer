(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsUiCategories = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function isReviewer(username) { return String(username || "").trim().toLocaleLowerCase() === "dog hat"; }

  function create(context) {
    const { addPagination, categories, closeSearch, element, history, nativeThreads, openResult, results,
      routeUrl, send, showStatus, statusPanel, stopProgress } = context;
    function picker() {
      closeSearch(); stopProgress(); nativeThreads.hidden = true; results.hidden = false; results.dataset.state = "results";
      const panel = element("section", "fewercunts-category-picker");
      const heading = element("h2", "post-title", "Browse by category");
      const label = element("label", "fewercunts-category-picker-label", "Category");
      const select = element("select", "fewercunts-category-picker-select");
      for (const [id, name] of categories.TAXONOMY) select.add(new Option(name, id));
      const open = element("button", "fewercunts-category-picker-open link-text", "View category"); open.type = "button";
      open.addEventListener("click", () => { history.pushState(null, "", routeUrl({ view: "category", category: select.value, page: 1 }));
        show(select.value, 1).catch(error => showStatus(`Category error: ${error.message}`, "error")); });
      label.appendChild(select); panel.append(heading, label, open); results.replaceChildren(panel);
    }
    async function show(categoryId = "uncategorised", page = 1) {
      categoryId = categories.resolve(categoryId) || "uncategorised"; page = Math.max(1, Number(page) || 1);
      closeSearch(); stopProgress(); showStatus("Loading category…", "loading");
      const response = await send({ type: "fewercunts-search:category-threads", categoryId,
        offset: (page - 1) * context.pageSize(), limit: context.pageSize() });
      nativeThreads.hidden = true; results.hidden = false; results.dataset.state = response.total ? "results" : "empty";
      const categoryLabel = categories.TAXONOMY.find(item => item[0] === categoryId)?.[1] || categoryId;
      const children = [statusPanel(response.total ? "results" : "empty", `${response.total} ${categoryLabel} threads`)];
      const chooser = element("label", "fewercunts-category-filter", "Category ");
      const select = element("select", "fewercunts-category-filter-select"); select.setAttribute("aria-label", "Filter forum by category");
      for (const [id, name] of categories.TAXONOMY) select.add(new Option(name, id));
      select.value = categoryId;
      select.addEventListener("change", () => { history.pushState({}, "", routeUrl({ view: "category", category: select.value, page: 1 })); show(select.value, 1); });
      chooser.appendChild(select); children.push(chooser);
      const reviewer = isReviewer(context.forumUsername());
      for (const item of response.items) {
        const row = element("article", "thread-header thread-underline row fewercunts-category-result");
        const subject = element("div", "col-xs-6"); const link = element("a", "link-text", item.title || "Untitled thread");
        link.href = item.canonicalUrl; link.addEventListener("click", event => { event.preventDefault(); openResult(item, false); }); subject.appendChild(link);
        const from = element("div", "col-xs-2", item.username || "Unknown");
        const when = element("div", "col-xs-2", new Date(item.createdUtc).toLocaleDateString()); const action = element("div", "col-xs-2");
        if (reviewer && categoryId === "uncategorised") {
          const category = element("select", "fewercunts-review-category"); category.setAttribute("aria-label", `Category for thread ${item.threadId}`);
          for (const [id, name] of categories.TAXONOMY.filter(item => item[0] !== "uncategorised")) category.add(new Option(name, id));
          const save = element("button", "fewercunts-review-save link-text", "Save"); save.type = "button";
          const state = element("span", "fewercunts-category-review-status", ""); state.setAttribute("role", "status");
          save.addEventListener("click", async () => { save.disabled = true; category.disabled = true;
            try { await send({ type: "fewercunts-search:category-submit", threadId: item.threadId, categoryId: category.value });
              save.textContent = "Saved"; state.textContent = "Queued for tonight's publication."; }
            catch (error) { save.textContent = "Failed"; save.title = error.message; }
            finally { save.disabled = false; category.disabled = false; } });
          action.append(category, save, state);
        }
        row.append(subject, from, when, action); children.push(row);
      }
      addPagination(children, response.total, page, "Category pagination", { view: "category", category: categoryId }, target => show(categoryId, target));
      results.replaceChildren(...children);
    }
    return { picker, show };
  }

  return { create, isReviewer };
});
