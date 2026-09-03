#!/usr/bin/env python3
"""Verify Unloved uses shared pagination with durable route state and real offsets."""

import json
from pathlib import Path
import shutil
import tempfile

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as conditions


ROOT = Path(__file__).resolve().parents[1]
PAGER = '.fewercunts-pagination[aria-label="Unloved pagination"]'


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-unloved-pagination-") as temporary:
        extension = Path(temporary) / "extension"
        shutil.copytree(ROOT, extension, ignore=shutil.ignore_patterns(".git", "dist", "__pycache__"))
        manifest_path = extension / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        scripts = manifest["content_scripts"][1]["js"]
        scripts.insert(scripts.index("search/ui.js"), "tests/unloved-pagination-ui-shim.js")
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        profile = Path(temporary) / "profile"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                         f"--disable-extensions-except={extension}", f"--load-extension={extension}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=.1)
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": "try { localStorage.setItem('fewercunts.pagination-mode','pages'); } catch (_) {}"
        })

        def page_number(expected, first_title=None):
            try:
                selector = f"{PAGER} .fewercunts-page-input"
                def matching(browser):
                    node = browser.find_element(By.CSS_SELECTOR, selector)
                    current_titles = titles()
                    return node if (node.get_attribute("value") == f"{expected:02d}"
                                    and (first_title is None or (current_titles and current_titles[0] == first_title))) else False
                return wait.until(matching)
            except TimeoutException as error:
                diagnostic = driver.execute_script("""
                  return {url: location.href, rows: document.querySelectorAll('.fewercunts-unloved-thread').length,
                    requests: document.documentElement.dataset.unlovedPaginationRequests || null,
                    pager: document.querySelector('.fewercunts-page-input')?.value || null};
                """)
                raise AssertionError(f"page {expected} did not render: {diagnostic}") from error

        def titles():
            return [node.text for node in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-unloved-thread .col-xs-6 a")]

        def control(label):
            return driver.find_element(By.CSS_SELECTOR, f'{PAGER} [aria-label="{label} page"]')

        def enter_page(value):
            return driver.execute_script("""
              const input = document.querySelector(arguments[0] + ' .fewercunts-page-input');
              input.focus(); input.value = arguments[1];
              input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
              return input.getAttribute('aria-invalid');
            """, PAGER, value)

        try:
            driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
                "source": "try { localStorage.setItem('fewercunts.rows-per-page','25'); } catch (_) {}"
            })
            route = "#view=unloved&sort=oldest&author=alice&visibility=public&page=2"
            driver.get(f"https://ntforum.net/{route}")
            page_input = page_number(2)
            assert titles()[0] == "Unloved thread 26" and titles()[-1] == "Unloved thread 50"
            assert driver.find_element(By.CSS_SELECTOR, f"{PAGER} .fewercunts-page-total").text == "12"
            assert all(control(label).is_enabled() for label in ("First", "Previous", "Next", "Last"))
            assert page_input.get_attribute("inputmode") == "numeric"
            assert page_input.get_attribute("aria-valuemin") == "1" and page_input.get_attribute("aria-valuemax") == "12"

            control("Last").click()
            page_number(12)
            assert titles() == ["Unloved thread 276", "Unloved thread 277"]
            assert driver.current_url.endswith("#view=unloved&sort=oldest&author=alice&visibility=public&page=12")
            assert not control("Next").is_enabled() and not control("Last").is_enabled()

            driver.back(); page_number(2); assert titles()[0] == "Unloved thread 26"
            driver.forward(); page_number(12); assert titles()[0] == "Unloved thread 276"
            control("First").click(); page_number(1)
            assert titles()[0] == "Unloved thread 1"
            assert driver.current_url.endswith("#view=unloved&sort=oldest&author=alice&visibility=public")
            assert not control("First").is_enabled() and not control("Previous").is_enabled()

            enter_page("10"); page_number(10); assert titles()[0] == "Unloved thread 226"
            control("Next").click(); page_number(11); assert titles()[0] == "Unloved thread 251"
            control("Previous").click(); page_number(10); assert titles()[0] == "Unloved thread 226"
            stable_url, stable_titles = driver.current_url, titles()
            for invalid in ("", "word", "2.5", "-1", "0", "13"):
                enter_page(invalid)
                assert driver.find_element(By.CSS_SELECTOR, f"{PAGER} .fewercunts-page-input").get_attribute("aria-invalid") == "true"
                assert driver.current_url == stable_url and titles() == stable_titles

            requests_before_reload = json.loads(driver.find_element(By.TAG_NAME, "html").get_attribute("data-unloved-pagination-requests"))
            old_input = driver.find_element(By.CSS_SELECTOR, f"{PAGER} .fewercunts-page-input")
            driver.refresh(); wait.until(conditions.staleness_of(old_input))
            page_number(10, "Unloved thread 226")
            driver.get("https://ntforum.net/#view=unloved&sort=oldest&author=alice&visibility=public&page=999")
            page_number(1); assert titles()[0] == "Unloved thread 1"
            assert driver.current_url.endswith("#view=unloved&sort=oldest&author=alice&visibility=public")

            driver.set_window_size(390, 844)
            pager = driver.find_element(By.CSS_SELECTOR, PAGER)
            assert pager.is_displayed()
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            assert all(control(label).get_attribute("aria-label") == f"{label} page"
                       for label in ("First", "Previous", "Next", "Last"))
            requests = requests_before_reload + json.loads(driver.find_element(By.TAG_NAME, "html").get_attribute("data-unloved-pagination-requests"))
            assert any(request["offset"] == 25 for request in requests)
            assert any(request["offset"] == 275 for request in requests)
            assert any(request["offset"] == 225 for request in requests)
        finally:
            driver.quit()
    print({"result": "pass", "pages": 12, "total": 277, "contentOffsets": True,
           "routeState": True, "boundaries": True, "invalidInput": True,
           "formatting": "01-09 and 10+", "history": True, "reload": True,
           "deepLink": True, "mobile": "390x844", "accessibility": True})


if __name__ == "__main__":
    main()
