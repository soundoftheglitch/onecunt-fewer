#!/usr/bin/env python3
"""Verify themed Muted management and non-persistent reveal behavior."""

import json
from pathlib import Path
import shutil
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]


def visible(page, selector):
    return [node for node in page.find_elements(By.CSS_SELECTOR, selector) if node.is_displayed()]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-muted-ui-") as temporary:
        extension = Path(temporary) / "extension"
        shutil.copytree(ROOT, extension, ignore=shutil.ignore_patterns(".git", "dist", "__pycache__"))
        manifest_path = extension / "manifest.json"; manifest = json.loads(manifest_path.read_text())
        isolated = manifest["content_scripts"][1]["js"]
        isolated.insert(isolated.index("search/ui.js"), "tests/muted-ui-shim.js")
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
                document.documentElement.dataset.mutedNavigation = JSON.stringify(detail);
                document.dispatchEvent(new CustomEvent('fewercunts:navigate-to-post-result', {
                  detail: JSON.stringify({requestId: detail.requestId, ok: true})}));
              }, true);
            """})
            driver.set_page_load_timeout(30); driver.set_window_size(390, 844); driver.get("https://ntforum.net/")
            view = wait.until(lambda page: next((item for item in visible(page, ".fewercunts-menu > button.fewercunts-top-nav")
                if item.text.strip() == "View"), False))
            view.click()
            muted_menu = wait.until(lambda page: next((item for item in visible(page, ".fewercunts-menu-item")
                if item.text.strip() == "Muted"), False))
            muted_menu.click(); wait.until(lambda page: page.current_url.endswith("#view=muted"))
            rows = wait.until(lambda page: visible(page, ".fewercunts-muted-thread"))
            assert len(rows) == 1 and "Muted fixture" in rows[0].text and "Unmute" in rows[0].text
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            reveal = driver.find_element(By.XPATH, "//button[normalize-space()='Reveal hidden']")
            reveal.click(); wait.until(lambda page: visible(page, ".fewercunts-reveal-status"))
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-reveal-status").text == "Hidden content revealed"
            assert driver.find_element(By.XPATH, "//button[normalize-space()='Hide again']").get_attribute("aria-pressed") == "true"
            rows = visible(driver, ".fewercunts-muted-thread"); rows[0].find_element(By.CSS_SELECTOR, "a[href*='/thread/']").click()
            navigation = wait.until(lambda page: page.execute_script("return document.documentElement.dataset.mutedNavigation || ''"))
            assert json.loads(navigation)["thread"]["Id"] == 15249
            messages = json.loads(driver.execute_script("return document.documentElement.dataset.mutedMessages"))
            assert "fewercunts-search:muted" in messages and not any("update" in value for value in messages if value != "fewercunts-search:update-status")
            search = driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']")
            search.click(); field = driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-form .search-bar")
            field.send_keys("fixture")
            driver.execute_script("arguments[0].closest('form').requestSubmit()", field)
            wait.until(lambda page: "fewercunts-search:query" in page.execute_script(
                "return document.documentElement.dataset.mutedMessages || ''"))
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-result") or page.execute_script(
                "return document.querySelector('.fewercunts-search-results')?.dataset.state === 'error'"))
            rendered = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-result")
            in_view = rendered and driver.execute_script("const r=arguments[0].getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight", rendered[0])
            assert in_view, driver.execute_script("""
              const n=document.querySelector('.fewercunts-search-results');
              const r=n?.querySelector('.fewercunts-result'), s=r && getComputedStyle(r), box=r?.getBoundingClientRect();
              return {state:n?.dataset.state, hidden:n?.hidden, text:n?.innerText,
                result:{html:r?.outerHTML, display:s?.display, visibility:s?.visibility, opacity:s?.opacity,
                  box:box && {x:box.x,y:box.y,width:box.width,height:box.height}},
                messages:document.documentElement.dataset.mutedMessages};
            """)
            result = rendered[0]
            assert len(result.find_elements(By.CSS_SELECTOR, ".fewercunts-thread-actions")) == 1
            read_only = result.find_elements(By.CSS_SELECTOR, ".fewercunts-result-archived[aria-label*='temporarily view only']")
            detail = driver.execute_script("const n=arguments[0];const s=getComputedStyle(n),r=n.getBoundingClientRect();return {html:n.outerHTML,display:s.display,visibility:s.visibility,opacity:s.opacity,width:r.width,height:r.height,parent:n.parentElement.outerHTML}", read_only[0]) if read_only else {}
            assert len(read_only) == 1 and detail["width"] > 0 and detail["height"] > 0 and read_only[0].get_attribute("textContent") == "View only", detail
            assert not result.find_elements(By.XPATH, ".//button[normalize-space()='Reply']"), result.text
            driver.get("https://ntforum.net/")
            view = wait.until(lambda page: next((item for item in visible(page, ".fewercunts-menu > button.fewercunts-top-nav")
                if item.text.strip() == "View"), False)); view.click()
            muted_menu = wait.until(lambda page: next((item for item in visible(page, ".fewercunts-menu-item")
                if item.text.strip() == "Muted"), False)); muted_menu.click()
            wait.until(lambda page: visible(page, ".fewercunts-muted-thread"))
            assert not visible(driver, ".fewercunts-reveal-status")
            assert driver.find_element(By.XPATH, "//button[normalize-space()='Reveal hidden']").get_attribute("aria-pressed") == "false"
        finally:
            driver.quit()
    print({"result": "pass", "mutedView": True, "reveal": True, "navigation": True,
           "revealReset": True, "noUpdateRequest": True, "mobile": "390x844"})


if __name__ == "__main__":
    main()
