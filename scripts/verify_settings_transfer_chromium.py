#!/usr/bin/env python3
"""Verify private settings export/import, safe failure, rollback and restart."""

import json
from pathlib import Path
import shutil
import tempfile
import time

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def prepare(temporary: Path):
    extension = temporary / "extension"; shutil.copytree(ROOT, extension, ignore=shutil.ignore_patterns(".git", "dist", "__pycache__"))
    manifest_path = extension / "manifest.json"; manifest = json.loads(manifest_path.read_text())
    isolated = manifest["content_scripts"][1]["js"]
    isolated.insert(isolated.index("search/ui.js"), "tests/settings-transfer-ui-shim.js")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return extension


def open_driver(profile: Path, extension: Path, downloads: Path):
    options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
    options.add_experimental_option("prefs", {"download.default_directory": str(downloads),
        "download.prompt_for_download": False, "download.directory_upgrade": True})
    for argument in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                     f"--disable-extensions-except={extension}", f"--load-extension={extension}"):
        options.add_argument(argument)
    return webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)


def visible(page, selector):
    return [node for node in page.find_elements(By.CSS_SELECTOR, selector) if node.is_displayed()]


def user_action(driver, wait, label):
    user = wait.until(lambda page: next((node for node in visible(page, ".fewercunts-menu > .fewercunts-top-nav") if node.text == "User"), False))
    if user.get_attribute("aria-expanded") != "true": user.click()
    item = wait.until(lambda page: next((node for node in page.find_elements(By.CSS_SELECTOR, ".fewercunts-menu-item")
        if node.get_attribute("textContent").strip() == label), False))
    driver.execute_script("arguments[0].scrollIntoView({block:'nearest'})", item)
    wait.until(lambda _page: item.is_displayed() and item.is_enabled())
    item.click()


def fixture_state(driver):
    return json.loads(driver.execute_script("return document.documentElement.dataset.transferFixture"))


def upload(driver, wait, path: Path, accept=True):
    field = driver.find_element(By.CSS_SELECTOR, ".fewercunts-settings-import")
    field.send_keys(str(path))
    alert = wait.until(lambda page: page.switch_to.alert)
    preview = alert.text
    if accept: alert.accept()
    else: alert.dismiss()
    return preview


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-transfer-") as value:
        temporary = Path(value); extension = prepare(temporary); profile = temporary / "profile"; downloads = temporary / "downloads"; downloads.mkdir()
        valid = {"schema": "fewercunts-local-settings", "version": 3, "exportedUtc": "2026-09-01T09:00:00.000Z",
          "settings": {"blockedUsernames": ["Alice"],
            "pagination": {"rows": 10, "mode": "pages"},
            "search": {"autoUpdate": False, "refreshMinutes": 60, "fullReconcileDays": 14, "replyReconcileDays": 60}},
          "index": {"phase": "complete", "source": "compiled", "generationId": "remote-only",
            "documents": 999, "threads": 99, "lastUpdatedUtc": "2026-09-01T09:00:00.000Z"}}
        valid_path = temporary / "valid.json"; valid_path.write_text(json.dumps(valid))
        driver = open_driver(profile, extension, downloads); wait = WebDriverWait(driver, 40, poll_frequency=.1)
        try:
            driver.set_window_size(390, 844); driver.get("https://ntforum.net/")
            wait.until(lambda page: visible(page, ".fewercunts-primary-nav"))
            assert not driver.find_element(By.CSS_SELECTOR, ".fewercunts-settings-import").is_displayed()
            user_action(driver, wait, "Export settings")
            exported_path = downloads / "fewercunts-settings-v3.json"
            wait.until(lambda _page: exported_path.exists() and exported_path.stat().st_size > 0)
            exported = json.loads(exported_path.read_text()); serialized = json.dumps(exported)
            assert exported["settings"]["blockedUsernames"] == ["Soulisdead"]
            assert exported["index"]["documents"] == 363276 and exported["index"]["generationId"] == "search-compact-v1"
            for forbidden in ("privateBody", "must not export", "never@example.test", "query", "draft", "notification"):
                assert forbidden not in serialized

            user_action(driver, wait, "Import settings")
            preview = upload(driver, wait, valid_path)
            assert "blocked users: 1" in preview.lower() and "Index metadata is informational" in preview
            wait.until(lambda page: "Local settings imported" in page.find_element(By.CSS_SELECTOR, ".fewercunts-settings-status").get_attribute("textContent"))
            assert driver.execute_script("return [localStorage.getItem('fewercunts.rows-per-page'), localStorage.getItem('fewercunts.pagination-mode')]") == ["10", "pages"]
            assert fixture_state(driver) == {"settings": {"enabled": False, "refreshMinutes": 60,
              "fullReconcileDays": 14, "replyReconcileDays": 60}, "blocked": ["Alice"]}

            cancelled = dict(valid); cancelled["settings"] = dict(valid["settings"]); cancelled["settings"]["pagination"] = {"rows": 15, "mode": "incremental"}
            cancelled_path = temporary / "cancelled.json"; cancelled_path.write_text(json.dumps(cancelled))
            user_action(driver, wait, "Import settings"); upload(driver, wait, cancelled_path, accept=False)
            wait.until(lambda page: "cancelled" in page.find_element(By.CSS_SELECTOR, ".fewercunts-settings-status").get_attribute("textContent"))

            before = {"rows": driver.execute_script("return localStorage.getItem('fewercunts.rows-per-page')"), "fixture": fixture_state(driver)}
            invalid_files = {
              "malformed.json": "not json",
              "unsupported.json": json.dumps({"schema": "fewercunts-local-settings", "version": 99}),
              "oversized.json": "x" * (64 * 1024 + 1)
            }
            for name, content in invalid_files.items():
                path = temporary / name; path.write_text(content)
                user_action(driver, wait, "Import settings")
                driver.find_element(By.CSS_SELECTOR, ".fewercunts-settings-import").send_keys(str(path))
                wait.until(lambda page: "failed safely" in page.find_element(By.CSS_SELECTOR, ".fewercunts-settings-status").get_attribute("textContent"))
                assert {"rows": driver.execute_script("return localStorage.getItem('fewercunts.rows-per-page')"), "fixture": fixture_state(driver)} == before

            rollback = json.loads(json.dumps(valid)); rollback["settings"]["pagination"] = {"rows": 15, "mode": "incremental"}
            rollback["settings"]["blockedUsernames"] = ["FAIL"]
            rollback_path = temporary / "rollback.json"; rollback_path.write_text(json.dumps(rollback))
            user_action(driver, wait, "Import settings"); upload(driver, wait, rollback_path)
            wait.until(lambda page: "failed safely" in page.find_element(By.CSS_SELECTOR, ".fewercunts-settings-status").get_attribute("textContent"))
            assert {"rows": driver.execute_script("return localStorage.getItem('fewercunts.rows-per-page')"), "fixture": fixture_state(driver)} == before
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        finally:
            driver.quit()

        driver = open_driver(profile, extension, downloads); wait = WebDriverWait(driver, 40, poll_frequency=.1)
        try:
            driver.get("https://ntforum.net/"); wait.until(lambda page: visible(page, ".fewercunts-primary-nav"))
            assert driver.execute_script("return [localStorage.getItem('fewercunts.rows-per-page'), localStorage.getItem('fewercunts.pagination-mode')]") == ["10", "pages"]
            assert fixture_state(driver)["blocked"] == ["Alice"]
        finally:
            driver.quit()
    print({"result": "pass", "download": True, "previewConfirmation": True, "apply": True,
           "restartPersistence": True, "malformedUnsupportedOversizedSafe": True, "rollback": True,
           "privacyAllowlist": True, "metadataInformationalOnly": True, "mobile": "390x844"})


if __name__ == "__main__":
    main()
