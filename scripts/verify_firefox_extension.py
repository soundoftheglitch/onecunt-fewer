#!/usr/bin/env python3
"""Install the real Firefox XPI and verify search, blocker UI and restart persistence."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import StaleElementReferenceException

ROOT = Path(__file__).resolve().parents[1]


def open_driver(profile: Path, package: Path, *, install: bool) -> webdriver.Firefox:
    options = webdriver.FirefoxOptions(); options.add_argument("-headless")
    options.binary_location = shutil.which("firefox") or shutil.which("firefox-esr")
    options.add_argument("-profile"); options.add_argument(str(profile))
    options.set_preference("xpinstall.signatures.required", False)
    driver = webdriver.Firefox(service=Service("/home/x0ar/.local/bin/geckodriver"), options=options)
    if install:
        addon_id = driver.install_addon(str(package.resolve()), temporary=False)
        if addon_id != "fewercunts@soundoftheglitch.github.io":
            raise AssertionError(f"Unexpected Firefox extension ID: {addon_id}")
    return driver


def exercise(driver: webdriver.Firefox, *, expect_restart: bool) -> dict:
    stage = "restart" if expect_restart else "fresh"
    print(f"Firefox {stage}: opening NTForum", flush=True)
    driver.get("https://ntforum.net/"); wait = WebDriverWait(driver, 900, poll_frequency=.2)
    def canonical_navigation(page):
        items = page.find_elements(By.CSS_SELECTOR,
          ".fewercunts-primary-nav > .fewercunts-top-nav, .fewercunts-primary-nav > .fewercunts-menu > .fewercunts-top-nav")
        return items if [item.text for item in items] == ["Home", "User", "New Topic", "View", "Search", "About"] else False
    navigation = wait.until(canonical_navigation)
    source = driver.find_element(By.ID, "theforum").text.lower()
    if "soulisdead" in source or "monkeybutler" in source:
        raise AssertionError("Firefox rendered a blocked author")
    driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']").click()
    field = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']"))
    search_started = time.monotonic(); field.send_keys("GTA", Keys.ENTER)
    print(f"Firefox {stage}: search submitted", flush=True)
    def visible_visit(page):
        try:
            errors = [node.text for node in page.find_elements(By.CSS_SELECTOR, ".fewercunts-search-status-error") if node.is_displayed()]
            if errors:
                raise AssertionError(f"Firefox search failed: {'; '.join(errors)}")
            return next((link.get_attribute("href") for link in page.find_elements(
                By.CSS_SELECTOR, ".fewercunts-result .fewercunts-result-visit") if link.is_displayed()), None)
        except StaleElementReferenceException:
            return None
    visit_href = wait.until(visible_visit)
    if not visit_href.startswith("https://ntforum.net/thread/"):
        raise AssertionError("Firefox result did not expose a canonical NTForum target")
    storage = driver.find_element(By.CSS_SELECTOR, ".fewercunts-storage-status").text
    if "posts" not in storage or "threads" not in storage:
        raise AssertionError(f"Firefox search storage status is incomplete: {storage}")
    ready_seconds = time.monotonic() - search_started if expect_restart else None
    print(f"Firefox {stage}: search ready ({storage})", flush=True)
    visible_result_count = driver.execute_script(
        "return [...document.querySelectorAll('.fewercunts-result')].filter(item => item.getClientRects().length).length")
    if expect_restart:
        update = driver.find_element(By.XPATH, "//button[normalize-space()='Update now']")
        update.click()
        wait.until(lambda page: page.find_element(By.XPATH, "//button[normalize-space()='Update now']").is_enabled())
        if driver.find_elements(By.CSS_SELECTOR, ".fewercunts-search-status-error"):
            raise AssertionError("Firefox incremental update displayed an error")

    return {"results": max(1, visible_result_count),
            "storage": storage, "restart": expect_restart,
            "readySeconds": ready_seconds}


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    package = ROOT / "dist" / f"fewerCunts-firefox-{manifest['version']}.xpi"
    if not package.is_file(): raise SystemExit(f"Missing Firefox package: {package}")
    with tempfile.TemporaryDirectory(prefix="fewercunts-firefox-extension-") as temporary:
        temporary_path = Path(temporary)
        temporary_path.chmod(0o755)
        profile = temporary_path / "profile"; profile.mkdir()
        installed_package = temporary_path / package.name
        shutil.copyfile(package, installed_package)
        installed_package.chmod(0o644)
        first = open_driver(profile, installed_package, install=True)
        try: initial = exercise(first, expect_restart=False)
        finally: first.quit()
        restarted = open_driver(profile, installed_package, install=False)
        try: reopened = exercise(restarted, expect_restart=True)
        finally: restarted.quit()
        if reopened["readySeconds"] > 90:
            raise AssertionError("Restarted Firefox search did not reopen its persisted index promptly")
    print(json.dumps({"result": "pass", "browser": "Firefox", "version": manifest["version"],
                      "freshResults": initial["results"], "restartResults": reopened["results"],
                      "restartPersistence": True, "incrementalUpdate": True,
                      "blocker": True, "canonicalNavigation": True,
                      "restartReadySeconds": round(reopened["readySeconds"], 2)}, sort_keys=True))


if __name__ == "__main__": main()
