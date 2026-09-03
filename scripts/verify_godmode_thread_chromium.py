#!/usr/bin/env python3
"""Verify the real developer-thread reply-title and availability contract."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
from urllib.request import urlopen

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as conditions
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
POINTER = "https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v4.5.0/search-latest.json"


def main() -> None:
    pointer = json.load(urlopen(POINTER))
    expected = f"{json.loads((ROOT / 'manifest.json').read_text())['version']}+{pointer['watermark'][:10].replace('-', '')}"
    with tempfile.TemporaryDirectory(prefix="fewercunts-godmode-") as profile:
        options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                         f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 300, poll_frequency=.2)
        try:
            driver.get("https://ntforum.net/")
            welcome = wait.until(conditions.element_to_be_clickable((By.CSS_SELECTOR,
                ".fewercunts-native-threads a[href*='/thread/15249']")))
            assert welcome.text == "Welcome to godMode"
            welcome.click()
            wait.until(lambda page: page.execute_script("""
              const vm=ko.dataFor(document.getElementById('theforum'));
              return vm.expandedThread() && vm.expandedThread().id() === 15249;
            """))
            preparing = wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR,
                ".fewercunts-native-reply-guard")))
            assert preparing.text == "Preparing…"
            assert "preparing" in preparing.get_attribute("aria-label").lower()
            reply = wait.until(lambda page: page.execute_script("""
              const node=Array.from(document.querySelectorAll('#theforum .post-container .post-reply-button > .link-text'))
                .find(item => item.textContent.trim() === 'Reply' && item.getClientRects().length);
              return Boolean(node);
            """))
            assert reply
            assert driver.execute_script("""
              const node=Array.from(document.querySelectorAll('#theforum .post-container .post-reply-button > .link-text'))
                .find(item => item.textContent.trim() === 'Reply' && item.getClientRects().length);
              if (!node) return false; node.click(); return true;
            """)
            title = wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR,
                "#theforum .post-input-form input[data-bind*='newMessageTitle']")))
            wait.until(lambda page: title.get_attribute("value") == expected)
            assert title.get_attribute("readonly") is not None
            assert title.get_attribute("aria-readonly") == "true"
            driver.execute_script("""
              const vm=ko.dataFor(document.getElementById('theforum'));
              vm.newMessageTitle('tampered title');
            """)
            wait.until(lambda page: title.get_attribute("value") == expected)

            driver.find_element(By.XPATH,
                "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Home']").click()
            ordinary = wait.until(lambda page: page.execute_script("""
              const node=Array.from(document.querySelectorAll('.fewercunts-native-threads a[href*="/thread/"]'))
                .find(item => !item.href.includes('/thread/15249') && item.getClientRects().length);
              if (!node) return false; node.click(); return true;
            """))
            assert ordinary
            wait.until(lambda page: page.execute_script("""
              const vm=ko.dataFor(document.getElementById('theforum'));
              return vm.expandedThread() && vm.expandedThread().id() !== 15249;
            """))
            assert driver.execute_script("""
              const node=Array.from(document.querySelectorAll('#theforum .post-container .post-reply-button > .link-text'))
                .find(item => item.textContent.trim() === 'Reply' && item.getClientRects().length);
              if (!node) return false; node.click(); return true;
            """)
            ordinary_title = wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR,
                "#theforum .post-input-form input[data-bind*='newMessageTitle']")))
            assert ordinary_title.get_attribute("readonly") is None
            assert "fewercunts-developer-title" not in ordinary_title.get_attribute("class").split()
        finally:
            driver.quit()
    print({"result": "pass", "threadId": 15249, "lockedTitle": expected,
           "missingIndexGuard": True, "tamperResistance": True, "ordinaryThreadsUnaffected": True})


if __name__ == "__main__":
    main()
