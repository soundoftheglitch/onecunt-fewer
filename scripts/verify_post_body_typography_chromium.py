#!/usr/bin/env python3
"""Verify that fewerCunts preserves NTForum's native post-body typography."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as conditions
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
THREAD_URL = "https://ntforum.net/"
PROPERTIES = ("fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing")


def snapshot(*, extension: bool) -> dict:
    with tempfile.TemporaryDirectory(prefix="fewercunts-post-typography-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-gpu")
        options.add_argument(f"--user-data-dir={profile}")
        if extension:
            options.add_argument(f"--disable-extensions-except={ROOT}")
            options.add_argument(f"--load-extension={ROOT}")
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        try:
            driver.get(THREAD_URL)
            wait = WebDriverWait(driver, 90)
            wait.until(lambda page: page.execute_script(
                "const view=ko.dataFor(document.getElementById('theforum'));"
                "return view && view.threads && view.threads().length > 0"))
            driver.execute_script(
                "const view=ko.dataFor(document.getElementById('theforum')); view.expandThread(view.threads()[0])")
            if extension:
                driver.execute_script(
                    "document.documentElement.classList.remove('fewercunts-starting');"
                    "document.querySelector('.fewercunts-startup-loader')?.remove()")
            if extension:
                wait.until(conditions.presence_of_element_located((By.CSS_SELECTOR, ".fewercunts-category-control")))
                driver.execute_script("document.querySelector('.post-body .post-message')?.closest('.post-container')?.classList.add('fewercunts-unread')")
            return wait.until(lambda page: page.execute_script(
                """
                const body = document.querySelector('.post-body .post-message');
                const title = document.querySelector('.post-title');
                const properties = arguments[0];
                if (!body || !title || !body.getClientRects().length) return null;
                const values = node => Object.fromEntries(properties.map(name => [name, getComputedStyle(node)[name]]));
                const ancestry = node => {
                  const result = [];
                  for (let current = node; current && result.length < 7; current = current.parentElement) {
                    result.push({tag: current.tagName.toLowerCase(), id: current.id, classes: [...current.classList]});
                  }
                  return result;
                };
                return {
                  body: values(body), title: values(title), titleHeight: title.getBoundingClientRect().height,
                  categoryInsideTitle: Boolean(title.querySelector('.fewercunts-category-control')),
                  categoryAfterAuthor: Boolean(body.closest('.post-body')?.querySelector('.post-author + .fewercunts-category-control')),
                  ancestry: ancestry(body), text: body.textContent.trim().slice(0, 80)
                };
                """,
                list(PROPERTIES),
            ))
        finally:
            driver.quit()


def main() -> None:
    native = snapshot(extension=False)
    extension = snapshot(extension=True)
    print(json.dumps({"native": native, "extension": extension}, indent=2, sort_keys=True))
    assert extension["body"] == native["body"], (
        "post-body typography differs from NTForum native styling: "
        f"native={native['body']} extension={extension['body']}"
    )
    assert not extension["categoryInsideTitle"], "category control must remain outside the native title strip"
    assert extension["categoryAfterAuthor"], "category control must follow native author metadata"
    assert extension["titleHeight"] == native["titleHeight"], (
        f"category UI changed native title-strip height: native={native['titleHeight']} extension={extension['titleHeight']}"
    )


if __name__ == "__main__":
    main()
