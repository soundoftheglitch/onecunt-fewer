#!/usr/bin/env python3
"""Verify that View -> Unloved reads the populated signed catalogue in Chromium."""

from pathlib import Path
from datetime import datetime
import re
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as conditions
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-unloved-chromium-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-gpu")
        options.add_argument(f"--user-data-dir={profile}")
        options.add_argument(f"--disable-extensions-except={ROOT}")
        options.add_argument(f"--load-extension={ROOT}")
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        try:
            driver.get("https://ntforum.net/")
            wait = WebDriverWait(driver, 120)
            wait.until(conditions.element_to_be_clickable((By.XPATH,
                "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='View']"))).click()
            wait.until(conditions.element_to_be_clickable((By.XPATH,
                "//button[@role='menuitem' and normalize-space()='Unloved']"))).click()
            snapshot = wait.until(lambda page: page.execute_script("""
              const status = document.querySelector('.fewercunts-search-status-results');
              const rows = [...document.querySelectorAll('.fewercunts-unloved-thread')];
              if (!status || !rows.length) return null;
              return {status: status.textContent.trim(), sizes: rows.map(row => row.querySelector('.col-xs-1')?.textContent.trim()),
                dates: rows.map(row => [...row.querySelectorAll('.col-xs-2')].at(-1)?.textContent.trim())};
            """))
            status = snapshot["status"]
            match = re.search(r"(\d+) indexed unloved threads?", status)
            assert match and int(match.group(1)) >= len(snapshot["sizes"]) > 0, status
            assert all(value == "1" for value in snapshot["sizes"])
            dates = snapshot["dates"]
            date_key = lambda value: datetime.strptime(value, "%m/%d/%Y")
            assert dates == sorted(dates, key=date_key), dates
            print({"result": "pass", "indexedUnloved": int(match.group(1)), "visibleRows": len(snapshot["sizes"])})
        finally:
            driver.quit()


if __name__ == "__main__":
    main()
