#!/usr/bin/env python3
"""Verify the offline About routes and native top-navigation integration."""

from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-about-") as profile:
        options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
        for value in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                      f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"):
            options.add_argument(value)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 60)
        try:
            driver.set_window_size(1280, 720); driver.get("https://ntforum.net/")
            wait.until(lambda page: not page.find_elements(By.CSS_SELECTOR, ".fewercunts-starting"))
            wait.until(EC.element_to_be_clickable((By.XPATH, "//button[normalize-space()='About']")))
            driver.find_element(By.XPATH, "//button[normalize-space()='Search']").click()
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-form").is_displayed()
            driver.find_element(By.XPATH, "//button[normalize-space()='About']").click()
            driver.find_element(By.XPATH, "//button[@role='menuitem' and normalize-space()='Readme']").click()
            wait.until(lambda page: page.current_url.endswith("#view=about&section=readme"))
            assert not driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-form").is_displayed()
            version = json.loads((extension / "manifest.json").read_text())["version"]
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-about-version").text == f"Installed version {version}"
            copy = " ".join(driver.execute_script(
                "return document.querySelector('.fewercunts-search-results').textContent").split()).casefold()
            assert "signed compact forum index" in copy and "browser history" in copy
            driver.find_element(By.XPATH, "//button[normalize-space()='About']").click()
            driver.find_element(By.XPATH, "//button[@role='menuitem' and normalize-space()='Version history']").click()
            wait.until(lambda page: page.current_url.endswith("#view=about&section=history"))
            versions = [node.text.split(" — ")[0] for node in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-version-heading")]
            assert versions == [version]
            driver.back(); wait.until(lambda page: page.current_url.endswith("#view=about&section=readme"))
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-results-heading").text == "About fewerCunts"
            driver.refresh(); wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-about-section"))
            driver.set_window_size(390, 844)
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        finally:
            driver.quit()
    print({"result": "pass", "routes": ["Readme", "Version history"], "offlineContent": True,
           "history": True, "reload": True, "searchCloses": True, "mobile": True})


if __name__ == "__main__": main()
