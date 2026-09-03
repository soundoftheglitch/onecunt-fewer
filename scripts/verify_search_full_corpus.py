#!/usr/bin/env python3
"""Benchmark the GitHub bootstrap and prove the full index survives Chromium restart."""

from __future__ import annotations

import json
from pathlib import Path
import re
import tempfile
import time

from selenium import webdriver
from selenium.common.exceptions import NoAlertPresentException, NoSuchElementException, StaleElementReferenceException, TimeoutException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_DOCUMENTS = 363_276
EXPECTED_THREADS = 15_243


def browser(profile: str) -> webdriver.Chrome:
    options = webdriver.ChromeOptions()
    options.binary_location = "/usr/bin/chromium"
    for argument in (
        "--headless=new", "--no-sandbox", "--disable-gpu",
        f"--user-data-dir={profile}", f"--disable-extensions-except={ROOT}",
        f"--load-extension={ROOT}",
    ):
        options.add_argument(argument)
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": "try { localStorage.setItem('fewercunts.rows-per-page','10'); localStorage.setItem('fewercunts.pagination-mode','pages'); } catch (_) {}"
    })
    return driver


def open_search(driver: webdriver.Chrome) -> WebDriverWait:
    driver.get("https://ntforum.net/")
    wait = WebDriverWait(driver, 600, poll_frequency=0.5)
    wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-primary-nav"))
    search_control = wait.until(lambda page: next((button for button in page.find_elements(
        By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']")
        if button.is_displayed() and button.is_enabled()), False))
    search_control.click()
    wait.until(lambda page: page.find_element(By.CSS_SELECTOR, ".fewercunts-search-form").is_displayed())
    return wait


def storage_text(driver: webdriver.Chrome) -> str:
    return driver.find_element(By.CSS_SELECTOR, ".fewercunts-storage-status").text


def status_text(driver: webdriver.Chrome) -> str:
    try:
        return driver.execute_script(
            "return [...document.querySelectorAll('.fewercunts-search-status')]"
            ".find(item => item.offsetParent)?.innerText || ''")
    except (NoSuchElementException, StaleElementReferenceException):
        return ""


def corpus_ready(driver: webdriver.Chrome) -> bool:
    text = storage_text(driver)
    match = re.search(r"([\d,]+) posts, ([\d,]+) threads", text)
    if not match:
        return False
    documents, threads = (int(value.replace(",", "")) for value in match.groups())
    return documents >= EXPECTED_DOCUMENTS and threads >= EXPECTED_THREADS


def query(driver: webdriver.Chrome, wait: WebDriverWait, value: str) -> dict:
    search = driver.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']")
    search.send_keys(Keys.CONTROL, "a", Keys.BACKSPACE)
    started = time.perf_counter()
    search.send_keys(value, Keys.ENTER)
    wait.until(lambda page: value in status_text(page) and page.execute_script(
        "return [...document.querySelectorAll('.fewercunts-search-status-results,"
        ".fewercunts-search-status-empty')].some(item => item.offsetParent)"))
    wait.until(lambda page: page.execute_script(
        "return [...document.querySelectorAll('.fewercunts-result')].some(item => item.offsetParent)"))
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    return {
        "query": value,
        "milliseconds": elapsed_ms,
        "rendered": driver.execute_script(
            "return [...document.querySelectorAll('.fewercunts-result')].filter(item => item.offsetParent).length"),
        "status": status_text(driver),
    }


def requested_urls(driver: webdriver.Chrome) -> list[str]:
    urls = []
    for entry in driver.get_log("performance"):
        message = json.loads(entry["message"])["message"]
        if message["method"] == "Network.requestWillBeSent":
            urls.append(message["params"]["request"]["url"])
    return urls


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-full-corpus-") as profile:
        first = browser(profile)
        started = time.perf_counter()
        try:
            wait = open_search(first)
            search = first.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']")
            search.send_keys("GTA", Keys.ENTER)
            try:
                WebDriverWait(first, 5).until(lambda page: page.switch_to.alert)
                first.switch_to.alert.accept()
            except (NoAlertPresentException, TimeoutException):
                pass
            wait.until(lambda page: "for “GTA”" in status_text(page))
            wait.until(corpus_ready)
            bootstrap_seconds = round(time.perf_counter() - started, 2)
            cold = [query(first, wait, value) for value in ("GTA", "coffee", "music", '"hip hop"', "electro*")]
            warm = [query(first, wait, value) for value in ("GTA", "coffee", "music", '"hip hop"', "electro*")]
            if any(item["rendered"] < 1 for item in cold + warm):
                raise AssertionError(f"Known full-corpus query rendered no visible result: {cold + warm}")
            query(first, wait, "coffee")
            posts_status = status_text(first)
            posts_total = int(re.search(r"([\d,]+) results? for", posts_status).group(1).replace(",", ""))
            coffee_pager = first.find_element(By.CSS_SELECTOR,
                '.fewercunts-pagination[aria-label="Search results pagination"]')
            coffee_pages = int(coffee_pager.find_element(By.CSS_SELECTOR, ".fewercunts-page-total").get_attribute("textContent"))
            if coffee_pages <= 1:
                raise AssertionError("Coffee did not expose its known multi-page result set")
            first_keys = first.execute_script("return [...document.querySelectorAll('.fewercunts-result [data-fewercunts-doc-key]')].map(node => node.dataset.fewercuntsDocKey)")
            coffee_pager.find_element(By.CSS_SELECTOR, '[aria-label="Next page"]').click()
            wait.until(lambda page: page.current_url.endswith("page=2") and page.execute_script(
                "return document.querySelector('.fewercunts-pagination[aria-label=\"Search results pagination\"] .fewercunts-page-input')?.value === '02'"))
            second_keys = first.execute_script("return [...document.querySelectorAll('.fewercunts-result [data-fewercunts-doc-key]')].map(node => node.dataset.fewercuntsDocKey)")
            if not first_keys or not second_keys or set(first_keys).intersection(second_keys):
                raise AssertionError("Coffee page two did not render a distinct result window")
            replies_tab = first.find_element(By.XPATH,
                "//div[contains(@class,'fewercunts-search-tabs')]//button[normalize-space()='Replies']")
            first.execute_script("arguments[0].click()", replies_tab)
            wait.until(lambda page: "tab=replies" in page.current_url and "Replies:" in status_text(page))
            replies_status = status_text(first)
            replies_total = int(re.search(r"([\d,]+) results? for", replies_status).group(1).replace(",", ""))
            if posts_total < 1 or replies_total <= 500:
                raise AssertionError(f"Coffee tab totals were unexpectedly bounded: posts={posts_total}, replies={replies_total}")
            first_reply_keys = first.execute_script(
                "return [...document.querySelectorAll('.fewercunts-result [data-fewercunts-doc-key]')].map(node => node.dataset.fewercuntsDocKey)")
            first.execute_script("""
              const input = document.querySelector('.fewercunts-pagination[aria-label="Search results pagination"] .fewercunts-page-input');
              input.focus(); input.value = '51';
              input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
            """)
            wait.until(lambda page: page.current_url.endswith("page=51") and page.execute_script(
                "return document.querySelector('.fewercunts-pagination[aria-label=\"Search results pagination\"] .fewercunts-page-input')?.value === '51'"))
            beyond_fifty_keys = first.execute_script(
                "return [...document.querySelectorAll('.fewercunts-result [data-fewercunts-doc-key]')].map(node => node.dataset.fewercuntsDocKey)")
            if not beyond_fifty_keys or set(first_reply_keys).intersection(beyond_fifty_keys):
                raise AssertionError("Coffee replies beyond offset 500 were truncated or repeated")
            urls = requested_urls(first)
            network = {
                "githubSnapshotRequests": sum("github.com" in url or "githubusercontent.com" in url for url in urls),
                "ntforumApiRequests": sum("ntforum.net/api/forum/" in url for url in urls),
            }
        finally:
            first.quit()

        second = browser(profile)
        restart_started = time.perf_counter()
        try:
            wait = open_search(second)
            wait.until(corpus_ready)
            restart_ms = round((time.perf_counter() - restart_started) * 1000, 1)
            persisted = query(second, wait, "GTA")
            if persisted["rendered"] < 1:
                raise AssertionError("Persisted restart query rendered no visible result")
        finally:
            second.quit()

    print(json.dumps({
        "result": "pass", "documents": EXPECTED_DOCUMENTS, "threads": EXPECTED_THREADS,
        "bootstrapSeconds": bootstrap_seconds, "restartReadyMilliseconds": restart_ms,
        "coldQueries": cold, "warmQueries": warm,
        "coffee": {"postsTotal": posts_total, "repliesTotal": replies_total, "replyOffset": 500},
        "restartQuery": persisted, "network": network,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
