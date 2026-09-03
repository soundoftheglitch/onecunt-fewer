#!/usr/bin/env python3
"""Verify that Search behaves as a transient top-navigation view."""

from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-search-panel-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu",
                         f"--user-data-dir={profile}", f"--disable-extensions-except={ROOT}",
                         f"--load-extension={ROOT}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=0.2)
        try:
            driver.get("https://ntforum.net/")
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-primary-nav"))
            driver.execute_script("document.documentElement.classList.remove('fewercunts-starting'); document.querySelector('.fewercunts-startup-loader')?.remove()")
            search_button = wait.until(lambda page: next((item for item in page.find_elements(By.XPATH,
                "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']") if item.is_displayed()), False))
            form = driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-form")
            field = form.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']")

            def open_search():
                if not form.is_displayed():
                    search_button.click()
                wait.until(lambda _page: form.is_displayed())
                field.send_keys(Keys.CONTROL, "a")
                field.send_keys("retain this query")
                assert search_button.get_attribute("aria-expanded") == "true"

            def assert_closed(query_retained=True):
                wait.until(lambda _page: not form.is_displayed())
                assert search_button.get_attribute("aria-expanded") == "false"
                if query_retained:
                    assert field.get_attribute("value") == "retain this query"

            open_search()
            driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
            assert_closed()

            for top_label in ("Home", "New Topic"):
                open_search()
                driver.find_element(By.XPATH, f"//button[contains(@class,'fewercunts-top-nav') and normalize-space()='{top_label}']").click()
                assert_closed()

            for item_label in ("Create Account", "Change Password", "Notifications", "Logout"):
                open_search()
                driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='User']").click()
                driver.find_element(By.XPATH, f"//button[@role='menuitem' and normalize-space()='{item_label}']").click()
                assert_closed()

            for item_label in ("Classic", "Unloved"):
                open_search()
                driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='View']").click()
                driver.find_element(By.XPATH, f"//button[@role='menuitem' and normalize-space()='{item_label}']").click()
                assert_closed()

            open_search()
            driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='View']").click()
            driver.find_element(By.XPATH, "//button[@role='menuitem' and normalize-space()='Classic']").click()
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-native-threads [data-fewercunts-author]"))
            open_search()
            driver.execute_script("arguments[0].click()", driver.find_elements(By.CSS_SELECTOR, ".fewercunts-native-threads [data-fewercunts-author]")[0])
            assert_closed(query_retained=False)
        finally:
            driver.quit()
    print({"result": "pass", "queryRetained": True, "topNav": True,
           "escape": True, "authorDestination": True})


if __name__ == "__main__":
    main()
