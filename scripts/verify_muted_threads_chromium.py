#!/usr/bin/env python3
"""Verify muted-thread bounds, dedupe, malformed recovery and restart persistence."""

import json
from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-muted-threads-") as profile:
        options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                         "--allow-file-access-from-files"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        try:
            driver.get((ROOT / "tests/muted-threads-browser.html").as_uri())
            text = WebDriverWait(driver, 30, poll_frequency=.1).until(
                lambda page: (value := page.find_element(By.ID, "result").text) != "running" and value)
            result = json.loads(text); assert result["pass"], result
        finally:
            driver.quit()
    print({"result": "pass", "deduplicated": True, "restartPersistence": True,
           "bounded": True, "malformedRecovery": True, "remove": True, "clear": True})


if __name__ == "__main__":
    main()
