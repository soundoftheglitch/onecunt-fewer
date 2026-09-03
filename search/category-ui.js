(function () {
  "use strict";
  const api = globalThis.browser?.runtime ? globalThis.browser : globalThis.chrome;
  const taxonomy = globalThis.FewerCuntsCategories.TAXONOMY;
  const names = new Map(taxonomy);
  const depth = id => String(id).split("/").length;
  const children = parent => taxonomy.filter(([id]) => id !== "uncategorised"
    && (parent ? id.startsWith(`${parent}/`) && depth(id) === depth(parent) + 1 : !id.includes("/")));
  const shortName = id => (names.get(id) || id).split(" › ").at(-1);
  const send = message => new Promise((resolve, reject) => {
    api.runtime.sendMessage(message, response => {
      const error = api.runtime.lastError;
      if (error) reject(error); else if (!response?.ok) reject(new Error(response?.error || "Category worker unavailable"));
      else resolve(response.value);
    });
  });
  function control(node) {
    const docKey = node.dataset.fewercuntsDocKey; const threadId = Number(node.dataset.fewercuntsThreadId);
    if (!globalThis.FewerCuntsCategories.validDocKey(docKey) || !Number.isSafeInteger(threadId)) return;
    const body = node.querySelector(":scope > .post-body");
    if (!body?.querySelector(":scope > .post-message")) return;
    const existing = body.querySelector(":scope > .fewercunts-category-control");
    if (existing?.dataset.fewercuntsDocKey === docKey
      && Number(existing.dataset.fewercuntsThreadId) === threadId) return;
    existing?.remove();
    node.dataset.fewercuntsCategoryControl = "true";
    const isReply = docKey.startsWith("r:");
    const label = document.createElement("div"); label.className = "fewercunts-category-control";
    label.dataset.fewercuntsDocKey = docKey; label.dataset.fewercuntsThreadId = String(threadId);
    const trigger = document.createElement("button"); trigger.className = "fewercunts-category-trigger link-text";
    trigger.type = "button"; trigger.textContent = "Category"; trigger.setAttribute("aria-expanded", "false");
    const panel = document.createElement("section"); panel.className = "fewercunts-category-panel"; panel.hidden = true;
    panel.id = `fewercunts-category-${docKey.replace(":", "-")}`; trigger.setAttribute("aria-controls", panel.id);
    const current = document.createElement("div"); current.className = "fewercunts-category-section fewercunts-category-current";
    const currentLabel = document.createElement("span"); currentLabel.className = "fewercunts-category-section-label"; currentLabel.textContent = "Current category";
    const cascade = document.createElement("span"); cascade.className = "fewercunts-category-cascade";
    const result = document.createElement("span"); result.className = "fewercunts-category-result";
    result.setAttribute("role", "status"); result.setAttribute("aria-live", "polite");
    const assign = document.createElement("div"); assign.className = "fewercunts-category-section fewercunts-category-assign";
    const assignLabel = document.createElement("span"); assignLabel.className = "fewercunts-category-section-label"; assignLabel.textContent = "Assign category";
    current.append(currentLabel, result); assign.append(assignLabel, cascade); panel.append(current, assign); label.append(trigger, panel);
    trigger.addEventListener("click", () => {
      const opening = panel.hidden; panel.hidden = !opening; trigger.setAttribute("aria-expanded", String(opening));
      if (opening) cascade.querySelector("select")?.focus();
    });
    label.addEventListener("keydown", event => {
      if (event.key !== "Escape" || panel.hidden) return;
      panel.hidden = true; trigger.setAttribute("aria-expanded", "false"); trigger.focus();
    });
    const author = body.querySelector?.(".post-author");
    if (author) author.insertAdjacentElement("afterend", label);
    else body.prepend(label);
    const disable = value => cascade.querySelectorAll("select").forEach(item => { item.disabled = value; });
    const save = async categoryId => {
      disable(true);
      result.textContent = "Saving…";
      try {
        const value = categoryId === "__inherit__"
          ? await send({ type: "fewercunts-search:category-inherit", docKey, threadId })
          : await send({ type: "fewercunts-search:category-set", docKey, threadId, categoryId });
        render(value);
      } catch (error) { label.title = error.message; result.textContent = `Not saved: ${error.message}`; disable(false); }
    };
    const addSelect = (items, selected, level, placeholder = null) => {
      const select = document.createElement("select"); select.className = "fewercunts-category-select";
      select.dataset.level = String(level);
      select.setAttribute("aria-label", `${level ? "Subcategory" : "Topic category"} for ${isReply ? "reply" : "post"} ${docKey.slice(2)}`);
      if (placeholder) select.add(new Option(placeholder, ""));
      for (const [id] of items) select.add(new Option(shortName(id), id));
      select.value = selected || "";
      select.addEventListener("change", () => { if (select.value) save(select.value); });
      cascade.appendChild(select);
    };
    const render = value => {
      cascade.replaceChildren();
      const inherited = isReply && value.source !== "manual";
      const selectedId = inherited ? "__inherit__" : value.categoryId;
      const rootItems = [["uncategorised", names.get("uncategorised")], ...children(null)];
      if (isReply) rootItems.unshift(["__inherit__", "Inherit from post"]);
      addSelect(rootItems, selectedId === "__inherit__" ? selectedId : selectedId.split("/")[0], 0);
      if (!inherited && selectedId !== "uncategorised") {
        const parts = selectedId.split("/");
        let parent = parts[0]; let level = 1;
        while (parent) {
          const choices = children(parent);
          if (!choices.length) break;
          const chosen = parts.length > level ? parts.slice(0, level + 1).join("/") : "";
          addSelect(choices, chosen, level, `Choose ${level === 1 ? "subcategory" : "type"}…`);
          if (!chosen) break;
          parent = chosen; level += 1;
        }
      }
      const categoryName = names.get(value.categoryId) || "Uncategorised";
      result.textContent = categoryName === "Uncategorised" ? "Unassigned"
        : `${inherited ? "Inherited: " : ""}${categoryName}`;
      label.title = `${categoryName} (${value.source})`;
      disable(false);
    };
    send({ type: "fewercunts-search:categories-get", items: [{ docKey, threadId }] }).then(items => {
      render(items[0]);
    }).catch(error => { label.title = error.message; });
  }
  const start = () => { const forum = document.getElementById("theforum"); if (!forum) return setTimeout(start, 50);
    globalThis.FewerCuntsDomLifecycle.observe(forum, {
      selector: ".post-container[data-fewercunts-doc-key]", decorate: control,
      attributeFilter: ["data-fewercunts-doc-key"]
    }); };
  start();
})();
