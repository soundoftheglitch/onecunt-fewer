#!/usr/bin/env python3
"""Verify bounded unread-state convergence and restart persistence in Chromium."""

import json
from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-read-state-") as profile:
        options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                         "--allow-file-access-from-files"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        try:
            driver.get((ROOT / "tests/read-state-browser.html").as_uri())
            text = WebDriverWait(driver, 30, poll_frequency=.1).until(
                lambda page: (value := page.find_element(By.ID, "result").text) != "running" and value)
            result = json.loads(text); assert result["pass"], result
            assert result == {"pass": True, "baseline": 0, "restart": 0, "partial": 1,
                              "firstUnread": "r:3", "editedReparented": 1, "deleted": 0,
                              "threadRead": 0, "visibleDocumentCount": 10,
                              "visibleUnreadAfterSevenRead": 2, "allVisibleRead": 0,
                              "newVisibleReplyUnread": 1, "bounded": 4,
                              "resetMarked": 4, "resetUnread": 4, "resetRestart": 4,
                              "globalReset": True, "materializedUnread": True,
                              "materializedRead": True, "resetCleared": True}
        finally:
            driver.quit()
    print({"result": "pass", "baseline": True, "restartPersistence": True,
           "partialRead": True, "firstUnread": True, "editReparentConvergence": True,
           "deletionConvergence": True, "blockedReplyExcluded": True,
           "exactVisiblePartialRead": "root + 9 visible replies; root + 7 replies read; 2 unread",
           "allVisibleRead": True, "newVisibleReplyReopensThread": True, "bounded": True})


if __name__ == "__main__":
    main()
