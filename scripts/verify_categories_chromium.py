#!/usr/bin/env python3
from pathlib import Path
import tempfile, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="fewercunts-categories-") as profile:
    options = Options()
    for arg in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}", "--allow-file-access-from-files"):
        options.add_argument(arg)
    driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
    try:
        driver.get((ROOT / "tests/categories-browser.html").as_uri())
        for _ in range(100):
            value = driver.find_element("id", "result").text
            if value != "running": break
            time.sleep(.05)
        assert value == "PASS", value
        driver.refresh()
        assert driver.find_element("id", "result").text in ("running", "PASS")
        print("category IndexedDB and inheritance verification passed")
    finally:
        driver.quit()
