#!/usr/bin/env python3
"""Verify compact delta persistence and private local fields in Chromium."""

import json
from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-compact-delta-") as profile:
        options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                         "--allow-file-access-from-files"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        try:
            driver.get((ROOT / "tests/compact-delta-browser.html").as_uri())
            text = WebDriverWait(driver, 30, poll_frequency=.1).until(
                lambda page: (value := page.find_element(By.ID, "result").text) != "running" and value)
            result = json.loads(text); assert result["pass"], result
            assert result == {"pass": True, "restartDocuments": 1, "privateEmailLocal": 1,
                              "navigationThread": 77, "persistentTombstones": 1}
        finally:
            driver.quit()
    print({"result": "pass", "restartPersistence": True, "privateEmailLocal": True,
           "tombstonePersistence": True, "canonicalNavigation": True})


if __name__ == "__main__":
    main()
