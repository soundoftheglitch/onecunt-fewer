(function () {
  "use strict";
  document.addEventListener("fewercunts:navigate-to-post", event => {
    event.stopImmediatePropagation();
    const detail = JSON.parse(event.detail || "{}");
    history.replaceState(history.state, "", detail.targetPostId
      ? `/thread/${detail.threadId}/reply/${detail.targetPostId}` : `/thread/${detail.threadId}`);
    document.dispatchEvent(new CustomEvent("fewercunts:navigate-to-post-result", {
      detail: JSON.stringify({ requestId: detail.requestId, ok: true })
    }));
  });
})();
