#!/usr/bin/env python3
"""Verify independent shared pagination for author Posts and Replies."""

import json
from pathlib import Path
import shutil
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-author-pagination-") as temporary:
        extension = Path(temporary) / "extension"
        shutil.copytree(ROOT, extension, ignore=shutil.ignore_patterns(".git", "dist", "__pycache__"))
        manifest_path = extension / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        scripts = manifest["content_scripts"][1]["js"]
        scripts.insert(scripts.index("search/ui.js"), "tests/author-pagination-ui-shim.js")
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu",
                         f"--user-data-dir={Path(temporary) / 'profile'}",
                         f"--disable-extensions-except={extension}", f"--load-extension={extension}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=.1)
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": "try { localStorage.setItem('fewercunts.pagination-mode','pages'); } catch (_) {}"
        })

        def pager(view):
            return f'.fewercunts-pagination[aria-label="{view.title()} by Alice pagination"]'

        def page_number(view, expected, first_title=None):
            selector = f"{pager(view)} .fewercunts-page-input"
            def matching(browser):
                # ntforum may perform a full navigation after a hash update. Its
                # unrelated native startup gate is outside this focused fixture.
                browser.execute_script("document.documentElement.classList.remove('fewercunts-starting'); document.querySelector('.fewercunts-startup-loader')?.remove()")
                node = next((item for item in browser.find_elements(By.CSS_SELECTOR, selector)
                             if item.is_displayed()), None)
                if node is None:
                    return False
                current_titles = titles(view)
                return node if (node.get_attribute("value") == f"{expected:02d}"
                                and (first_title is None or (current_titles and current_titles[0] == first_title))) else False
            try:
                return wait.until(matching)
            except TimeoutException as error:
                values = [(node.get_attribute("value"), node.is_displayed())
                          for node in driver.find_elements(By.CSS_SELECTOR, selector)]
                raise AssertionError({"view": view, "expected": expected,
                                      "url": driver.current_url, "inputs": values,
                                      "titles": titles(view)[:3],
                                      "results": driver.execute_script("""
                                        const node = document.querySelector('.fewercunts-search-results');
                                        return {exists: !!node, hidden: node?.hidden,
                                          connected: node?.isConnected,
                                          count: document.querySelectorAll('.fewercunts-search-results').length,
                                          rightSides: document.querySelectorAll('.forum-right-side').length,
                                          ancestors: node ? [...function*(){let x=node; while(x){yield [x.tagName,x.id,x.className,getComputedStyle(x).display,getComputedStyle(x).visibility]; x=x.parentElement;}}()] : []};
                                      """)}) from error

        def titles(view):
            selector = ".fewercunts-author-thread .col-xs-6 a" if view == "posts" else ".fewercunts-author-reply .post-title a"
            return [node.text for node in driver.find_elements(By.CSS_SELECTOR, selector) if node.is_displayed()]

        def control(view, label):
            return next(item for item in driver.find_elements(
                By.CSS_SELECTOR, f'{pager(view)} [aria-label="{label} page"]') if item.is_displayed())

        def enter_page(view, value):
            driver.execute_script("""
              const input = [...document.querySelectorAll(arguments[0] + ' .fewercunts-page-input')]
                .find(node => node.offsetParent !== null);
              input.focus(); input.value = arguments[1];
              input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
            """, pager(view), value)

        def select_tab(label):
            driver.find_element(By.XPATH, f'//button[contains(@class,"fewercunts-author-tab") and text()="{label}"]').click()

        try:
            driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
                "source": "try { localStorage.setItem('fewercunts.rows-per-page','25'); } catch (_) {}"
            })
            route = "#view=author&user=Alice&tab=posts&sort=newest&filter=public&postsPage=2&repliesPage=4"
            driver.get(f"https://ntforum.net/{route}")
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-primary-nav"))
            driver.execute_script("document.documentElement.classList.remove('fewercunts-starting'); document.querySelector('.fewercunts-startup-loader')?.remove()")
            page_number("posts", 2)
            assert titles("posts")[0] == "Post 26 by Alice"
            assert driver.find_element(By.CSS_SELECTOR, f"{pager('posts')} .fewercunts-page-total").text == "13"

            control("posts", "Next").click(); page_number("posts", 3, "Post 51 by Alice")
            control("posts", "Previous").click(); page_number("posts", 2, "Post 26 by Alice")
            enter_page("posts", "10"); page_number("posts", 10, "Post 226 by Alice")
            control("posts", "First").click(); page_number("posts", 1, "Post 1 by Alice")
            assert not control("posts", "First").is_enabled() and not control("posts", "Previous").is_enabled()

            control("posts", "Last").click(); page_number("posts", 13)
            assert titles("posts") == ["Post 301 by Alice", "Post 302 by Alice"]
            assert "sort=newest" in driver.current_url and "filter=public" in driver.current_url
            assert "postsPage=13" in driver.current_url and "repliesPage=4" in driver.current_url
            assert not control("posts", "Next").is_enabled() and not control("posts", "Last").is_enabled()

            select_tab("Replies"); page_number("replies", 4)
            assert titles("replies")[0] == "Reply 76 by Alice"
            control("replies", "Next").click(); page_number("replies", 5, "Reply 101 by Alice")
            control("replies", "Previous").click(); page_number("replies", 4, "Reply 76 by Alice")
            enter_page("replies", "10"); page_number("replies", 10, "Reply 226 by Alice")
            control("replies", "First").click(); page_number("replies", 1, "Reply 1 by Alice")
            assert not control("replies", "First").is_enabled() and not control("replies", "Previous").is_enabled()
            control("replies", "Last").click(); page_number("replies", 12)
            assert titles("replies") == ["Reply 276 by Alice", "Reply 277 by Alice"]
            assert "postsPage=13" in driver.current_url and "repliesPage=12" in driver.current_url

            select_tab("Posts"); page_number("posts", 13)
            driver.back(); page_number("replies", 12)
            driver.back(); page_number("replies", 1, "Reply 1 by Alice")
            driver.back(); page_number("replies", 10, "Reply 226 by Alice")
            driver.back(); page_number("replies", 4, "Reply 76 by Alice")
            driver.forward(); page_number("replies", 10, "Reply 226 by Alice")

            stable_url, stable_titles = driver.current_url, titles("replies")
            for invalid in ("", "word", "2.5", "-1", "0", "13"):
                enter_page("replies", invalid)
                input_node = driver.find_element(By.CSS_SELECTOR, f"{pager('replies')} .fewercunts-page-input")
                assert input_node.get_attribute("aria-invalid") == "true"
                assert driver.current_url == stable_url and titles("replies") == stable_titles

            enter_page("replies", "10"); page_number("replies", 10)
            assert titles("replies")[0] == "Reply 226 by Alice"
            requests_before_reload = json.loads(driver.find_element(By.TAG_NAME, "html").get_attribute("data-author-pagination-requests"))
            old_input = driver.find_element(By.CSS_SELECTOR, f"{pager('replies')} .fewercunts-page-input")
            driver.refresh(); wait.until(lambda browser: old_input.id not in [node.id for node in browser.find_elements(By.CSS_SELECTOR, ".fewercunts-page-input")])
            page_number("replies", 10, "Reply 226 by Alice")

            driver.get("https://ntforum.net/#view=author&user=Alice&tab=posts&sort=newest&postsPage=999&repliesPage=10")
            page_number("posts", 1); assert titles("posts")[0] == "Post 1 by Alice"
            assert "postsPage=" not in driver.current_url and "repliesPage=10" in driver.current_url

            driver.set_window_size(390, 844)
            assert driver.find_element(By.CSS_SELECTOR, pager("posts")).is_displayed()
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            assert all(control("posts", label).get_attribute("aria-label") == f"{label} page"
                       for label in ("First", "Previous", "Next", "Last"))
            requests = requests_before_reload + json.loads(driver.find_element(By.TAG_NAME, "html").get_attribute("data-author-pagination-requests"))
            assert any(row == {"kind": "posts", "username": "Alice", "offset": 25, "limit": 25} for row in requests)
            assert any(row["kind"] == "posts" and row["offset"] == 300 for row in requests)
            assert any(row["kind"] == "replies" and row["offset"] == 225 for row in requests)
        finally:
            driver.quit()
    print({"result": "pass", "views": ["Posts", "Replies"], "independentPages": True,
           "actualOffsets": True, "history": True, "reload": True, "deepLinks": True,
           "boundaries": True, "invalidInput": True, "formatting": "01-09 and 10+",
           "mobile": "390x844", "accessibility": True})


if __name__ == "__main__":
    main()
