#!/usr/bin/env python3
"""Verify durable compiled-index migration state in real Chromium IndexedDB."""
import json
import pathlib
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait

ROOT = pathlib.Path(__file__).resolve().parents[1]

with tempfile.TemporaryDirectory(prefix="fewercunts-index-migration-") as profile:
    options = Options()
    options.binary_location = "/usr/bin/chromium"
    options.add_argument(f"--user-data-dir={profile}")
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--allow-file-access-from-files")
    driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
    try:
        driver.get((ROOT / "tests/index-migration-browser.html").as_uri())
        result = WebDriverWait(driver, 30).until(lambda item: item.execute_script(
            "return window.result && Promise.resolve(window.result)"))
        if not result.get("pass"):
            raise RuntimeError(result)
        print(json.dumps(result, sort_keys=True))
    finally:
        driver.quit()
