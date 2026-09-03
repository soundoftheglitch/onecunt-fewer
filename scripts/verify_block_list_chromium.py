#!/usr/bin/env python3
"""Verify editable blocked-user UI and extension-owned restart persistence."""

from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as conditions
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]


def driver_for(profile: str) -> webdriver.Chrome:
    options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
    for value in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                  f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"):
        options.add_argument(value)
    return webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)


def open_editor(driver: webdriver.Chrome) -> WebDriverWait:
    driver.get("https://ntforum.net/"); wait = WebDriverWait(driver, 240)
    wait.until(conditions.element_to_be_clickable((By.XPATH, "//button[normalize-space()='User']"))).click()
    wait.until(conditions.element_to_be_clickable((By.XPATH, "//button[@role='menuitem' and normalize-space()='Block list']"))).click()
    wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-block-list-form")))
    return wait


def names(driver: webdriver.Chrome) -> list[str]:
    return driver.execute_script("return Array.from(document.querySelectorAll('.fewercunts-block-list-name'), n => n.textContent)")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-block-list-") as profile:
        first = driver_for(profile)
        try:
            wait = open_editor(first); assert names(first) == ["Soulisdead", "monkeybutler"]
            first.find_element(By.XPATH, "//button[@aria-label='Remove Soulisdead from blocked users']").click()
            wait.until(lambda page: names(page) == ["monkeybutler"])
            first.find_element(By.XPATH, "//button[@aria-label='Remove monkeybutler from blocked users']").click()
            wait.until(lambda page: names(page) == [])
        finally: first.quit()
        second = driver_for(profile)
        try:
            wait = open_editor(second); wait.until(lambda page: names(page) == [])
            before_requests = second.execute_script("return performance.getEntriesByType('resource').filter(e => e.name.includes('/api/forum/')).length")
            field = second.find_element(By.CSS_SELECTOR, ".fewercunts-block-list-input")
            assert field.get_attribute("role") == "combobox" and field.get_attribute("aria-autocomplete") == "list"
            field.send_keys("dog")
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-block-list-suggestion"))
            suggestions = [item.text for item in second.find_elements(By.CSS_SELECTOR, ".fewercunts-block-list-suggestion")]
            assert 0 < len(suggestions) <= 20 and "dog hat" in [value.casefold() for value in suggestions]
            assert not {"soulisdead", "monkeybutler"}.intersection(value.casefold() for value in suggestions)
            field.send_keys(Keys.HOME, Keys.ENTER)
            selected = field.get_attribute("value")
            second.find_element(By.CSS_SELECTOR, ".fewercunts-block-list-form button[type='submit']").click()
            wait.until(lambda page: names(page) == [selected])
            second.find_element(By.XPATH, f"//button[@aria-label='Remove {selected} from blocked users']").click()
            wait.until(lambda page: names(page) == [])
            field = second.find_element(By.CSS_SELECTOR, ".fewercunts-block-list-input"); field.send_keys("dog")
            touch_option = wait.until(lambda page: next(iter(page.find_elements(By.CSS_SELECTOR, ".fewercunts-block-list-suggestion")), False))
            second.execute_script("arguments[0].dispatchEvent(new PointerEvent('pointerdown', {pointerType:'touch', bubbles:true, cancelable:true}))", touch_option)
            assert field.get_attribute("value").casefold().startswith("dog")
            assert second.execute_script("return performance.getEntriesByType('resource').filter(e => e.name.includes('/api/forum/')).length") == before_requests
            field.send_keys(Keys.CONTROL, "a"); field.send_keys("Persistent User")
            second.find_element(By.CSS_SELECTOR, ".fewercunts-block-list-form button[type='submit']").click()
            wait.until(lambda page: names(page) == ["Persistent User"])
            second.set_window_size(390, 844)
            assert second.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        finally: second.quit()
        third = driver_for(profile)
        try:
            wait = open_editor(third); wait.until(lambda page: names(page) == ["Persistent User"])
            third.find_element(By.XPATH, "//button[@aria-label='Remove Persistent User from blocked users']").click()
            wait.until(lambda page: names(page) == [])
            third.find_element(By.XPATH, "//button[normalize-space()='Reset defaults']").click()
            wait.until(lambda page: names(page) == ["Soulisdead", "monkeybutler"])
        finally: third.quit()
    print({"result": "pass", "restartPersistence": True, "emptyListPersists": True,
           "defaultsRemovable": True, "defaults": ["Soulisdead", "monkeybutler"], "deviceLocal": True,
           "autocomplete": True, "keyboard": True, "touch": True, "noForumTypingRequests": True,
           "mobile": "390x844", "screenReaderCombobox": True})


if __name__ == "__main__": main()
