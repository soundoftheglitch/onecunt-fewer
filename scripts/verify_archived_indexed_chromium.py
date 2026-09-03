#!/usr/bin/env python3
"""Verify archived actions in deterministic indexed Search and author views."""

import json
from pathlib import Path
import shutil
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-archived-indexed-") as temporary:
        extension = Path(temporary) / "extension"
        shutil.copytree(ROOT, extension, ignore=shutil.ignore_patterns(".git", "dist", "__pycache__"))
        manifest_path = extension / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        isolated = manifest["content_scripts"][1]["js"]
        isolated.insert(isolated.index("search/ui.js"), "tests/archived-ui-shim.js")
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

        profile = Path(temporary) / "profile"
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu",
                         f"--user-data-dir={profile}", f"--disable-extensions-except={extension}",
                         f"--load-extension={extension}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=.2)
        try:
            driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
                "source": """
                  try { localStorage.setItem('fewercunts.rows-per-page','25'); } catch (_) {}
                  document.addEventListener('fewercunts:navigate-to-post', event => {
                    event.stopImmediatePropagation();
                    const detail = JSON.parse(event.detail);
                    document.documentElement.dataset.archivedNavigation = JSON.stringify(detail);
                    document.dispatchEvent(new CustomEvent('fewercunts:navigate-to-post-result', {
                      detail: JSON.stringify({requestId: detail.requestId, ok: true})
                    }));
                  }, true);
                """
            })
            driver.get("https://ntforum.net/")
            search_button = wait.until(lambda page: page.find_element(
                By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']"))
            search_button.click()
            field = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']"))
            field.send_keys("fixture", Keys.ENTER)
            results = wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-search-results .fewercunts-result"))
            assert len(results) == 2

            archived, adjacent = results
            label = archived.find_element(By.CSS_SELECTOR, ".fewercunts-result-archived")
            assert label.tag_name == "span" and label.text == "Archived"
            assert label.get_attribute("aria-label") == "Thread archived; replies are closed"
            assert not archived.find_elements(By.CSS_SELECTOR, "button.fewercunts-result-reply")
            assert adjacent.find_element(By.CSS_SELECTOR, "button.fewercunts-result-reply").text == "Reply"

            archived.find_element(By.CSS_SELECTOR, ".fewercunts-author-link").click()
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-author-thread"))
            assert not driver.find_elements(By.CSS_SELECTOR, ".fewercunts-author-thread .fewercunts-result-reply")
            tabs = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-author-tab")
            tabs[1].click()
            reply = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, ".fewercunts-author-reply"))
            author_label = reply.find_element(By.CSS_SELECTOR, ".fewercunts-result-archived")
            assert author_label.text == "Archived"
            assert not reply.find_elements(By.CSS_SELECTOR, "button.fewercunts-result-reply")
            driver.set_window_size(390, 844)
            assert author_label.is_displayed()
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            driver.set_window_size(1280, 900)

            driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']").click()
            def visible_search(page):
                candidate = page.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']")
                return candidate if candidate.is_displayed() else False

            field = wait.until(visible_search)
            field.send_keys(Keys.CONTROL, "a")
            field.send_keys("fixture", Keys.ENTER)
            archived = wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-search-results .fewercunts-result"))[0]
            archived.find_element(By.CSS_SELECTOR, ".fewercunts-result-visit").click()
            navigation = wait.until(lambda page: page.execute_script(
                "return document.documentElement.dataset.archivedNavigation || ''"))
            assert json.loads(navigation)["reply"] is False
            state = driver.execute_script("""
              const vm = ko.dataFor(document.getElementById('theforum'));
              return {form: vm.isShowingNewPostForm(), target: vm.postToReplyTo()};
            """)
            assert state == {"form": False, "target": None}
        finally:
            driver.quit()
    print({"result": "pass", "searchArchived": True, "adjacentReplyable": True,
           "visitWithoutReply": True, "authorPosts": True, "authorRepliesArchived": True,
           "accessibleText": True, "mobile": "390x844"})


if __name__ == "__main__":
    main()
