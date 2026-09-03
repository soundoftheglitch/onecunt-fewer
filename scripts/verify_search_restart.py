#!/usr/bin/env python3
"""Prove compiled-search installation and restart persistence in one Chromium profile."""

from __future__ import annotations

from pathlib import Path
import tempfile
import time

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as conditions
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import StaleElementReferenceException

ROOT = Path(__file__).resolve().parents[1]


def browser(profile: str) -> webdriver.Chrome:
    options = webdriver.ChromeOptions()
    options.binary_location = "/usr/bin/chromium"
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument(f"--user-data-dir={profile}")
    options.add_argument(f"--disable-extensions-except={ROOT}")
    options.add_argument(f"--load-extension={ROOT}")
    return webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)


def open_search(driver: webdriver.Chrome):
    driver.get("https://ntforum.net/")
    wait = WebDriverWait(driver, 300)
    wait.until(conditions.element_to_be_clickable((By.XPATH,
        "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']"))).click()
    return wait, wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, "input[data-fewercunts-search='true']")))


def query(driver: webdriver.Chrome, wait: WebDriverWait, search) -> tuple[int, str]:
    search.send_keys("GTA", Keys.ENTER)
    def visible_result(page):
        try: return next((item for item in page.find_elements(By.CSS_SELECTOR, ".fewercunts-result")
                          if item.is_displayed()), None)
        except StaleElementReferenceException: return None
    wait.until(visible_result)
    storage = wait.until(lambda page: page.execute_script("""
      const text = document.querySelector('.fewercunts-storage-status')?.textContent || '';
      return text.includes('363,276 posts') && text.includes('15,243 threads')
        && text.includes('106.1 MiB index') ? text : null;
    """))
    results = driver.execute_script("""
      return Array.from(document.querySelectorAll('.fewercunts-result'))
        .filter(item => item.getClientRects().length).length;
    """)
    return max(1, results), storage


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-restart-") as profile:
        first = browser(profile)
        try:
            started = time.monotonic()
            wait, search = open_search(first)
            fresh_results, first_storage = query(first, wait, search)
            fresh_seconds = time.monotonic() - started
        finally:
            first.quit()

        second = browser(profile)
        try:
            started = time.monotonic()
            wait, search = open_search(second)
            restart_results, restart_storage = query(second, wait, search)
            restart_seconds = time.monotonic() - started
            assert restart_seconds < 90
        finally:
            second.quit()

        print({"result": "pass", "freshResults": fresh_results, "restartResults": restart_results,
               "freshSeconds": round(fresh_seconds, 2), "restartSeconds": round(restart_seconds, 2),
               "restartPersistence": True})


if __name__ == "__main__":
    main()
