#!/usr/bin/env python3
"""Verify Saved view ordering, unread/missing states, navigation, removal and mobile semantics."""

import json
from pathlib import Path
import shutil
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-saved-ui-") as temporary:
        extension = Path(temporary) / "extension"
        shutil.copytree(ROOT, extension, ignore=shutil.ignore_patterns(".git", "dist", "__pycache__"))
        manifest_path = extension / "manifest.json"; manifest = json.loads(manifest_path.read_text())
        isolated = manifest["content_scripts"][1]["js"]
        isolated.insert(isolated.index("search/ui.js"), "tests/saved-ui-shim.js")
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={Path(temporary) / 'profile'}",
                         f"--disable-extensions-except={extension}", f"--load-extension={extension}"):
            options.add_argument(argument)
        options.set_capability("pageLoadStrategy", "eager")
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=.2)
        try:
            driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": """
              document.addEventListener('fewercunts:navigate-to-post', event => {
                event.stopImmediatePropagation(); const detail = JSON.parse(event.detail);
                document.documentElement.dataset.savedNavigation = JSON.stringify(detail);
                document.dispatchEvent(new CustomEvent('fewercunts:navigate-to-post-result', {
                  detail: JSON.stringify({requestId: detail.requestId, ok: true})}));
              }, true);
            """})
            driver.set_page_load_timeout(30); driver.set_window_size(390, 844); driver.get("https://ntforum.net/")
            view = wait.until(lambda page: next((item for item in page.find_elements(By.XPATH,
                "//button[normalize-space()='View']") if item.is_displayed()), False))
            view.click()
            saved_menu = wait.until(lambda page: next((item for item in page.find_elements(By.XPATH,
                "//button[@role='menuitem' and normalize-space()='Saved']") if item.is_displayed()), False))
            saved_menu.click()
            wait.until(lambda page: page.current_url.endswith("#view=saved"))
            rows = wait.until(lambda page: (visible := [item for item in page.find_elements(
                By.CSS_SELECTOR, ".fewercunts-saved-thread") if item.is_displayed()]) and len(visible) == 2 and visible)
            assert len(rows) == 2 and "Newest saved" in rows[0].text and "Missing saved" in rows[1].text
            assert rows[0].find_element(By.CSS_SELECTOR, ".fewercunts-unread-badge").text == "2 unread"
            assert "unavailable" in rows[1].find_element(By.CSS_SELECTOR, ".fewercunts-saved-missing").text
            assert not rows[1].find_elements(By.CSS_SELECTOR, "a[href*='/thread/']")
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            rows[0].find_element(By.CSS_SELECTOR, "a[href*='/thread/']").click()
            navigation = wait.until(lambda page: page.execute_script("return document.documentElement.dataset.savedNavigation || ''"))
            assert json.loads(navigation)["targetPostId"] == 15249
            wait.until(lambda page: "/thread/15249" in page.current_url)
            driver.back(); wait.until(lambda page: page.current_url.endswith("#view=saved"))
            wait.until(lambda page: page.execute_script("return [...document.querySelectorAll('.fewercunts-saved-thread')].filter(n=>getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden'&&n.getClientRects().length).length") == 2)
            rows = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-saved-thread")
            remove = wait.until(lambda page: page.find_element(By.XPATH,
                "//div[contains(@class,'fewercunts-saved-thread')][contains(.,'Missing saved')]//button[normalize-space()='Remove']"))
            assert remove.tag_name == "button" and remove.get_attribute("tabindex") in (None, "0")
            assert driver.execute_script("const n=arguments[0];return getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden'&&n.getClientRects().length>0", remove)
            driver.execute_script("arguments[0].click()", remove)
            wait.until(lambda page: len(page.find_elements(By.CSS_SELECTOR, ".fewercunts-saved-thread")) == 1)
        finally:
            driver.quit()
    print({"result": "pass", "ordering": True, "unread": True, "missing": True,
           "navigation": True, "remove": True, "history": True, "mobile": "390x844"})


if __name__ == "__main__":
    main()
