#!/usr/bin/env python3
"""Verify plugin links inherit NTForum's native visited-link theme rule."""

from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-visited-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu",
                         f"--user-data-dir={profile}", f"--disable-extensions-except={ROOT}",
                         f"--load-extension={ROOT}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=.2)
        try:
            driver.get("https://ntforum.net/")
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, "#theforum a.link-text[href]"))
            theme = driver.execute_script("""
              const root = getComputedStyle(document.documentElement);
              const normal = root.getPropertyValue('--secondary-accent-color').trim();
              const visited = root.getPropertyValue('--neutral-accent-color').trim();
              for (const sheet of document.styleSheets) {
                let rules;
                try { rules = sheet.cssRules; } catch (_) { continue; }
                for (const candidate of rules) {
                  if (candidate.selectorText === 'a.link-text:visited')
                    return {normal, visited, declaration: candidate.style.color};
                }
              }
              return null;
            """)
            assert theme and theme["declaration"] == "var(--neutral-accent-color)", theme
            assert theme["normal"] != theme["visited"], theme
            assert driver.find_elements(By.CSS_SELECTOR, ".fewercunts-search-results a.link-text, .fewercunts-native-threads a.link-text")
            driver.refresh()
            wait.until(lambda page: page.execute_script("return [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.selectorText === 'a.link-text:visited' && r.style.color === 'var(--neutral-accent-color)'); } catch (_) { return false; } });"))
        finally:
            driver.quit()
    print({"result": "pass", "nativeThemeInherited": True, "statesDistinct": True,
           "reloadPersistent": True})


if __name__ == "__main__":
    main()
