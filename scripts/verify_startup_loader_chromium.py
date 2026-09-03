#!/usr/bin/env python3
"""Verify that startup masking begins immediately and releases only on painted plugin state."""

from pathlib import Path
import tempfile
import time

from selenium import webdriver
from selenium.webdriver.chrome.service import Service


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-startup-loader-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        options.page_load_strategy = "none"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu",
                         "--disable-background-timer-throttling",
                         f"--user-data-dir={profile}", f"--disable-extensions-except={ROOT}",
                         f"--load-extension={ROOT}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        started = time.monotonic()
        observed = []
        masked_native = True
        try:
            driver.get("https://ntforum.net/")
            while time.monotonic() - started < 210:
                state = driver.execute_script("""
                  const root = document.documentElement;
                  const loader = document.querySelector('.fewercunts-startup-loader');
                  const progress = loader && loader.querySelector('progress');
                  const vm = document.getElementById('theforum') && globalThis.ko
                    ? ko.dataFor(document.getElementById('theforum')) : null;
                  const viewIds = vm && typeof vm.threads === 'function'
                    ? vm.threads().map(item => Number(typeof item.id === 'function' ? item.id() : item.id)) : [];
                  const renderedIds = [...document.querySelectorAll('#theforum .thread-header')]
                    .filter(node => node.getClientRects().length)
                    .map(node => { const item = ko.dataFor(node); const id = item && item.id;
                      return Number(typeof id === 'function' ? id() : id); });
                  const right = document.querySelector('#theforum .forum-right-side');
                  return { phase: root.dataset.fewercuntsStartup || '', loader: Boolean(loader),
                    value: progress ? Number(progress.value) : null,
                    viewportScroll: root.scrollHeight > root.clientHeight,
                    centred: loader ? (() => { const box = loader.querySelector('.fewercunts-startup-track').getBoundingClientRect();
                      return Math.abs((box.left + box.right) / 2 - innerWidth / 2) <= 2
                        && Math.abs((box.top + box.bottom) / 2 - innerHeight / 2) <= 2; })() : null,
                    hasOutput: Boolean(loader && loader.querySelector('output')),
                    nativeHidden: [...document.querySelectorAll('#theforum > :not(.fewercunts-startup-loader)')]
                      .every(node => getComputedStyle(node).visibility === 'hidden'),
                    pluginReady: viewIds.length > 0 && JSON.stringify(renderedIds) === JSON.stringify(viewIds)
                      && Boolean(document.querySelector('.fewercunts-rows-control'))
                      && Boolean(document.querySelector('.fewercunts-pagination'))
                      && Boolean(right && right.classList.contains('fewercunts-density-scroll')) };
                """)
                assert not state["hasOutput"], state
                if state["value"] is not None and (not observed or observed[-1] != state["value"]):
                    observed.append(state["value"])
                if state["phase"] == "loading" and state["loader"]:
                    masked_native = masked_native and state["nativeHidden"]
                    assert state["viewportScroll"] is False, state
                    assert state["centred"] is True, state
                if state["phase"] == "ready":
                    assert not state["loader"] and state["pluginReady"], state
                    break
                time.sleep(0.01)
            else:
                raise AssertionError("startup loader did not reach a bounded ready state")
            assert observed and observed[0] <= 10 and observed[-1] == 100, observed
            assert observed == sorted(set(observed)), observed
            assert masked_native, "native forum content became visible while startup masking was active"
        finally:
            driver.quit()
    print({"result": "pass", "seconds": round(time.monotonic() - started, 2),
           "progress": observed, "paintedBeforeRelease": True, "visibleNumber": False})


if __name__ == "__main__":
    main()
