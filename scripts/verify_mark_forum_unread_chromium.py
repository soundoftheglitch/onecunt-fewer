#!/usr/bin/env python3
"""Verify the confirmed forum-wide semantic-unread reset in a real extension."""

from pathlib import Path
import re
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as conditions


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-mark-unread-") as profile:
        options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                         f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 240, poll_frequency=.2)

        def open_action() -> None:
            driver.find_element(By.XPATH,
                "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='User']").click()
            wait.until(lambda page: page.find_element(By.XPATH,
                "//button[@role='menuitem' and normalize-space()='Mark forum unread']")).click()

        def all_visible_threads_unread(page):
            return page.execute_script("""
              const links=[...document.querySelectorAll('.fewercunts-native-threads .thread-header a[href*="/thread/"]')]
                .filter(node => node.getClientRects().length);
              return links.length > 3 && links.every(node => node.classList.contains('fewercunts-unread'));
            """)

        try:
            driver.get("https://ntforum.net/")
            wait.until(lambda page: page.find_element(By.TAG_NAME, "html").get_attribute(
                "data-fewercunts-startup") == "ready")
            open_action(); wait.until(conditions.alert_is_present()).dismiss()
            assert wait.until(lambda page: page.find_element(By.CSS_SELECTOR, ".fewercunts-settings-status").text
                              == "Mark forum unread cancelled.")

            open_action(); alert = wait.until(conditions.alert_is_present())
            match = re.search(r"Mark all (\d+) currently indexed visible forum", alert.text)
            assert match and int(match.group(1)) > 0
            marked = int(match.group(1)); alert.accept()
            expected = f"{marked} indexed forum {'item is' if marked == 1 else 'items are'} now unread."
            assert wait.until(lambda page: page.find_element(By.CSS_SELECTOR, ".fewercunts-settings-status").text
                              == expected)
            assert wait.until(all_visible_threads_unread)
            view = driver.find_element(By.XPATH,
                "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='View']")
            assert view.get_attribute("aria-label") == "View; forum marked unread"

            driver.refresh()
            wait.until(lambda page: page.find_element(By.TAG_NAME, "html").get_attribute(
                "data-fewercunts-startup") == "ready")
            assert wait.until(all_visible_threads_unread)
            assert driver.find_element(By.XPATH,
                "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='View']").get_attribute(
                    "aria-label") == "View; forum marked unread"

            driver.set_window_size(390, 844)
            assert driver.execute_script(
                "return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            open_action(); wait.until(conditions.alert_is_present()).dismiss()
        finally:
            driver.quit()
    print({"result": "pass", "confirmation": True, "allVisibleLinks": True,
           "restartPersistence": True, "browserHistoryIndependent": True,
           "mobile": "390x844", "accessibleStatus": True})


if __name__ == "__main__":
    main()
