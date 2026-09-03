#!/usr/bin/env python3
"""Verify Search uses the shared pager with real request offsets and durable URL state."""

import json
from pathlib import Path
import shutil
import tempfile
import time

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as conditions
from selenium.common.exceptions import TimeoutException


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-search-pagination-") as temporary:
        extension = Path(temporary) / "extension"
        shutil.copytree(ROOT, extension, ignore=shutil.ignore_patterns(".git", "dist", "__pycache__"))
        manifest_path = extension / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        main_scripts = manifest["content_scripts"][0]["js"]
        main_scripts.insert(main_scripts.index("content.js"), "tests/navigation-state-main-shim.js")
        scripts = manifest["content_scripts"][1]["js"]
        scripts.insert(scripts.index("search/ui.js"), "tests/search-pagination-ui-shim.js")
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        profile = Path(temporary) / "profile"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                         f"--disable-extensions-except={extension}", f"--load-extension={extension}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=.1)

        def page_number(expected, first_title=None):
            try:
                selector = '.fewercunts-pagination[aria-label="Search results pagination"] .fewercunts-page-input'
                def matching(browser):
                    node = browser.find_element(By.CSS_SELECTOR, selector)
                    current_titles = titles()
                    return node if (node.get_attribute("value") == f"{expected:02d}"
                                    and (first_title is None or (current_titles and current_titles[0] == first_title))) else False
                return wait.until(matching)
            except TimeoutException as error:
                diagnostic = driver.execute_script("""
                  return {url: location.href, state: document.querySelector('.fewercunts-search-results')?.dataset.state,
                    status: Array.from(document.querySelectorAll('.fewercunts-search-status')).map(node => node.textContent),
                    results: document.querySelectorAll('.fewercunts-result').length,
                    requests: document.documentElement.dataset.searchPaginationRequests || null,
                    pager: document.querySelector('.fewercunts-page-input')?.value || null};
                """)
                raise AssertionError(f"page {expected} did not render: {diagnostic}") from error

        def titles():
            return [node.text for node in driver.find_elements(
                By.CSS_SELECTOR, ".fewercunts-result a[data-fewercunts-doc-key]")]

        def control(label):
            return driver.find_element(By.CSS_SELECTOR, f'.fewercunts-pagination[aria-label="Search results pagination"] [aria-label="{label} page"]')

        def enter_page(value):
            return driver.execute_script("""
              const input = document.querySelector('.fewercunts-pagination[aria-label="Search results pagination"] .fewercunts-page-input');
              input.focus(); input.value = arguments[0];
              input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
              return input.getAttribute('aria-invalid');
            """, value)

        try:
            driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
                "source": "try { localStorage.setItem('fewercunts.rows-per-page','25'); localStorage.setItem('fewercunts.pagination-mode','pages'); } catch (_) {}"
            })
            driver.get("https://ntforum.net/#view=search&q=needle&scopes=post%2Creplies&page=2")
            page_input = page_number(2)
            assert titles()[0] == "Needle result 26" and titles()[-1] == "Needle result 50"
            assert "277 results" in driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-status").text
            assert driver.find_element(By.CSS_SELECTOR, '.fewercunts-pagination[aria-label="Search results pagination"] .fewercunts-page-total').text == "12"
            assert control("First").is_enabled() and control("Previous").is_enabled()
            assert control("Next").is_enabled() and control("Last").is_enabled()
            assert page_input.get_attribute("inputmode") == "numeric"
            assert page_input.get_attribute("aria-valuemin") == "1" and page_input.get_attribute("aria-valuemax") == "12"
            snippet_links = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-result:first-of-type .fewercunts-snippet-link")
            assert len(snippet_links) == 2
            assert all(link.get_attribute("target") == "_blank" for link in snippet_links)
            assert all(link.get_attribute("rel") == "noopener noreferrer" for link in snippet_links)
            assert snippet_links[0].get_attribute("href") == "https://example.test/26"
            assert snippet_links[1].get_attribute("href") == "https://ntforum.net/thread/5025"

            control("Last").click()
            page_number(12)
            assert titles() == ["Needle result 276", "Needle result 277"]
            assert driver.current_url.endswith("#view=search&q=needle&scopes=post%2Creplies&page=12")
            assert not control("Next").is_enabled() and not control("Last").is_enabled()

            driver.back()
            page_number(2)
            assert titles()[0] == "Needle result 26"
            driver.forward()
            page_number(12)
            assert titles()[0] == "Needle result 276"

            control("First").click()
            page_number(1)
            assert titles()[0] == "Needle result 1"
            assert driver.current_url.endswith("#view=search&q=needle&scopes=post%2Creplies")
            assert not control("First").is_enabled() and not control("Previous").is_enabled()

            enter_page("10")
            page_number(10, "Needle result 226")
            assert titles()[0] == "Needle result 226"
            control("Next").click()
            page_number(11)
            assert titles()[0] == "Needle result 251"
            control("Previous").click()
            page_number(10)
            assert titles()[0] == "Needle result 226"

            driver.execute_script("window.scrollTo(0, 480)")
            origin_scroll = driver.execute_script("return window.scrollY")
            origin_url = driver.current_url
            origin_key = driver.execute_script("""
              const links=[...document.querySelectorAll('.fewercunts-result a[data-fewercunts-doc-key]')];
              const link=links.find(node => { const box=node.getBoundingClientRect();
                return box.top >= 0 && box.bottom <= innerHeight; });
              if (!link) return null; const key=link.dataset.fewercuntsDocKey; link.click(); return key;
            """)
            assert origin_key
            wait.until(lambda browser: "/thread/" in browser.current_url and "#view=" not in browser.current_url)
            driver.back()
            page_number(10, "Needle result 226")
            assert driver.current_url == origin_url
            assert driver.find_element(By.CSS_SELECTOR, f'[data-fewercunts-doc-key="{origin_key}"]').is_displayed()
            try:
                wait.until(lambda browser: abs(browser.execute_script("return window.scrollY") - origin_scroll) <= 2)
            except TimeoutException as error:
                current_scroll = driver.execute_script("return window.scrollY")
                maximum_scroll = driver.execute_script(
                    "return Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight)")
                navigation = driver.execute_script(
                    "return {state: history.state, saved: localStorage.getItem('fewercunts.navigation-state.v1')}")
                raise AssertionError(
                    f"search scroll position was not restored: origin={origin_scroll}, current={current_scroll}, "
                    f"maximum={maximum_scroll}, navigation={navigation}") from error
            assert driver.execute_script("return JSON.parse(localStorage.getItem('fewercunts.navigation-state.v1')).length") == 1
            driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav > button.fewercunts-top-nav:last-of-type").click()
            driver.find_element(By.XPATH, "//button[normalize-space()='Clear view state']").click()
            assert driver.execute_script("return localStorage.getItem('fewercunts.navigation-state.v1')") is None

            stable_url, stable_titles = driver.current_url, titles()
            for invalid in ("", "word", "2.5", "-1", "0", "13"):
                enter_page(invalid)
                page_input = driver.find_element(By.CSS_SELECTOR, '.fewercunts-pagination[aria-label="Search results pagination"] .fewercunts-page-input')
                assert page_input.get_attribute("aria-invalid") == "true"
                assert driver.current_url == stable_url and titles() == stable_titles

            requests_before_reload = json.loads(driver.find_element(By.TAG_NAME, "html").get_attribute("data-search-pagination-requests"))
            old_page_input = driver.find_element(By.CSS_SELECTOR, '.fewercunts-pagination[aria-label="Search results pagination"] .fewercunts-page-input')
            driver.refresh()
            wait.until(conditions.staleness_of(old_page_input))
            page_number(10)
            assert titles()[0] == "Needle result 226"
            driver.get("https://ntforum.net/#view=search&q=needle&scopes=post%2Creplies&page=999")
            page_number(1)
            assert titles()[0] == "Needle result 1"
            assert driver.current_url.endswith("#view=search&q=needle&scopes=post%2Creplies")

            driver.set_window_size(390, 844)
            pager = driver.find_element(By.CSS_SELECTOR, '.fewercunts-pagination[aria-label="Search results pagination"]')
            assert pager.is_displayed()
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            assert pager.get_attribute("aria-label") == "Search results pagination"
            assert all(control(label).get_attribute("aria-label") == f"{label} page"
                       for label in ("First", "Previous", "Next", "Last"))

            requests = requests_before_reload + json.loads(driver.find_element(By.TAG_NAME, "html").get_attribute("data-search-pagination-requests"))
            assert any(request["offset"] == 25 for request in requests)
            assert any(request["offset"] == 275 for request in requests)
            assert any(request["offset"] == 225 for request in requests)
            assert all(request["query"] == "needle" and request["scopes"] == ["post", "replies"] for request in requests)

            tabs = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-search-tabs [role='tab']")
            assert [tab.text for tab in tabs] == ["Posts", "Replies"]
            assert tabs[0].get_attribute("aria-selected") == "true" and tabs[0].get_attribute("tabindex") == "0"
            tabs[0].send_keys(Keys.END)
            page_number(1, "Needle result 1")
            assert driver.current_url.endswith("#view=search&q=needle&scopes=post%2Creplies&tab=replies")
            selected = driver.switch_to.active_element
            assert selected.text == "Replies" and selected.get_attribute("aria-selected") == "true"
            assert titles()[0] == "Needle result 1"
            control("Last").click()
            page_number(12)
            assert titles() == ["Needle result 276", "Needle result 277"]
            reply_requests = json.loads(driver.find_element(By.TAG_NAME, "html").get_attribute("data-search-pagination-requests"))
            assert any(request["resultKind"] == "r" and request["offset"] == 275 for request in reply_requests)
            driver.refresh()
            page_number(12)
            assert driver.find_element(By.CSS_SELECTOR,
                ".fewercunts-search-tabs [aria-selected='true']").text == "Replies"
            driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-tabs [role='tab']:first-child").click()
            page_number(1, "Needle result 1")
            assert "tab=" not in driver.current_url

            search_button = driver.find_element(By.XPATH,
                "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']")
            if not driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-form").is_displayed():
                search_button.click()
            search_field = driver.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']")
            for query in ("Second needle", "Needle"):
                search_field.send_keys(Keys.CONTROL, "a"); search_field.send_keys(query, Keys.ENTER)
                try:
                    wait.until(lambda browser: browser.find_element(By.CSS_SELECTOR, ".fewercunts-recent-searches").is_displayed())
                except TimeoutException as error:
                    diagnostic = driver.execute_script("""
                      return {url: location.href, value: document.querySelector('[data-fewercunts-search]')?.value,
                        state: document.querySelector('.fewercunts-search-results')?.dataset.state,
                        status: [...document.querySelectorAll('.fewercunts-search-status')].map(node => node.textContent),
                        recent: localStorage.getItem('fewercunts.recent-searches.v1'),
                        panel: document.querySelector('.fewercunts-recent-searches')?.outerHTML};
                    """)
                    raise AssertionError(f"recent search was not rendered: {diagnostic}") from error
            assert [node.text for node in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-recent-run")] == ["Needle", "Second needle"]
            driver.execute_script("localStorage.setItem('fewercunts.navigation-state.v1', '[]')")
        finally:
            driver.quit()

        restarted = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        try:
            restarted.get("https://ntforum.net/")
            restart_wait = WebDriverWait(restarted, 40, poll_frequency=.1)
            restart_wait.until(lambda browser: browser.find_elements(By.CSS_SELECTOR, ".fewercunts-primary-nav"))
            restarted.find_element(By.XPATH,
                "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']").click()
            restart_wait.until(lambda browser: browser.find_element(By.CSS_SELECTOR, ".fewercunts-recent-searches").is_displayed())
            suggestions = restarted.find_elements(By.CSS_SELECTOR, ".fewercunts-recent-run")
            assert [node.text for node in suggestions] == ["Needle", "Second needle"]
            assert all(node.tag_name == "button" for node in suggestions)
            suggestions[0].send_keys(Keys.ENTER)
            restart_wait.until(lambda browser: "q=Needle" in browser.current_url)
            assert restarted.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']").get_attribute("value") == "Needle"
            restarted.find_element(By.CSS_SELECTOR, ".fewercunts-recent-remove").click()
            assert len(restarted.find_elements(By.CSS_SELECTOR, ".fewercunts-recent-run")) == 1
            restarted.find_element(By.CSS_SELECTOR, ".fewercunts-recent-clear").click()
            assert not restarted.find_element(By.CSS_SELECTOR, ".fewercunts-recent-searches").is_displayed()
            assert restarted.execute_script("return localStorage.getItem('fewercunts.navigation-state.v1')") == "[]"
            assert restarted.execute_script("return localStorage.getItem('fewercunts.recent-searches.v1')") is None
        finally:
            restarted.quit()
    print({"result": "pass", "views": ["Posts", "Replies"], "pagesPerView": 12, "totalPerView": 277, "contentOffsets": True,
           "boundaries": True, "invalidInput": True, "formatting": "01-09 and 10+",
           "history": True, "resultBackRestore": True, "clearableLocalState": True,
           "recentSearches": True, "recentRestart": True, "recentRemoveAndClear": True,
           "reload": True, "deepLink": True, "mobile": "390x844", "accessibility": True})


if __name__ == "__main__":
    main()
