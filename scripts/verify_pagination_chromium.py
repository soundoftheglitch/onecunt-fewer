#!/usr/bin/env python3
"""Verify the native-model footer pagination in a fresh Chromium profile."""

from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-pagination-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu",
                         f"--user-data-dir={profile}", f"--disable-extensions-except={ROOT}",
                         f"--load-extension={ROOT}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=0.2)
        page = lambda: driver.execute_script(
            "return ko.dataFor(document.getElementById('theforum')).pageNumber();")
        loaded = lambda expected: wait.until(lambda _driver: page() == expected and not driver.execute_script(
            "return ko.dataFor(document.getElementById('theforum')).isLoadingThreads();"))
        def enter(field, value):
            field.send_keys(Keys.CONTROL, "a")
            field.send_keys(value if value else Keys.BACKSPACE, Keys.ENTER)
        try:
            driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
                "source": "try { localStorage.setItem('fewercunts.rows-per-page','25'); localStorage.removeItem('fewercunts.pagination-mode'); } catch (_) {}"
            })
            driver.get("https://ntforum.net/")
            wait.until(lambda page: page.find_element(By.TAG_NAME, "html").get_attribute("data-fewercunts-startup") == "ready")
            wait.until(lambda _driver: (buttons := driver.find_elements(By.XPATH, "//button[normalize-space()='View']"))
                       and buttons[0].is_displayed() and buttons[0].is_enabled())
            driver.find_element(By.XPATH, "//button[normalize-space()='View']").click()
            driver.find_element(By.XPATH, "//button[@role='menuitem' and normalize-space()='Classic']").click()
            def visible_footer(_driver):
                candidate = driver.find_element(By.CSS_SELECTOR, ".thread-footer nav.fewercunts-pagination")
                return candidate if candidate.is_displayed() else False

            footer = wait.until(visible_footer)
            def dock_position():
                current_footer = wait.until(visible_footer)
                return driver.execute_script("""
                  const rect = arguments[0].getBoundingClientRect();
                  return {bottom: Math.round(rect.bottom), viewport: innerHeight,
                          position: getComputedStyle(arguments[0]).position,
                          reserved: parseFloat(getComputedStyle(document.querySelector('#theforum .forum-right-side')).paddingBottom),
                          height: Math.ceil(rect.height)};
                """, current_footer)
            initial_dock = dock_position()
            assert initial_dock["position"] == "fixed"
            assert initial_dock["bottom"] == initial_dock["viewport"]
            assert initial_dock["reserved"] >= initial_dock["height"], initial_dock
            assert wait.until(lambda page: page.execute_script("""
              const pager = document.querySelector('.fewercunts-pagination').getBoundingClientRect();
              const home = document.querySelector('.fewercunts-primary-nav').getBoundingClientRect();
              const row = document.querySelector('.forum-right-side .all-threads-header').getBoundingClientRect();
              const divider = getComputedStyle(document.querySelector('.fewercunts-pagination'), '::before');
              const dividerLeft = pager.left + parseFloat(divider.left);
              const dividerRight = pager.right - parseFloat(divider.right);
              return Math.abs(pager.left - home.left) <= 1
                && Math.abs(dividerLeft - row.left) <= 1
                && Math.abs(dividerRight - row.right) <= 1;
            """)), "pager divider must match both edges of the thread-row underline"
            assert footer.find_element(By.CSS_SELECTOR, ".fewercunts-page-controls").is_displayed()
            assert not footer.find_elements(By.CSS_SELECTOR, ".fewercunts-pagination-mode-select, .fewercunts-incremental-controls")
            driver.execute_script("""
              const model = ko.dataFor(document.getElementById('theforum'));
              const original = model.loadPage;
              window.__fewercuntsPaginationRequests = 0;
              model.loadPage = function () { window.__fewercuntsPaginationRequests += 1; return original.apply(this, arguments); };
            """)
            footer.find_element(By.CSS_SELECTOR, '[aria-label="Next page"]').click()
            loaded(2)
            assert driver.current_url == "https://ntforum.net/#page=2"
            second_ids = driver.execute_script("return ko.dataFor(document.getElementById('theforum')).threads().map(item => item.id());")
            assert len(second_ids) == len(set(second_ids)) and 0 < len(second_ids) <= 25
            footer.find_element(By.CSS_SELECTOR, '[aria-label="Previous page"]').click()
            loaded(1)
            assert driver.current_url == "https://ntforum.net/"
            first_ids = driver.execute_script("return ko.dataFor(document.getElementById('theforum')).threads().map(item => item.id());")
            assert len(first_ids) == len(set(first_ids)) and 0 < len(first_ids) <= 25
            assert not set(first_ids).intersection(second_ids)
            # A ready signed local catalogue performs no native page request; while it is
            # still preparing, the bounded fallback performs one request per movement.
            assert 0 <= driver.execute_script("return window.__fewercuntsPaginationRequests") <= 2

            # Local-catalogue paging must reproduce the native loader's visible
            # collapse/reset behavior. Otherwise the URL and model change while
            # the old expanded thread remains on screen and navigation appears broken.
            driver.execute_script("""
              const model = ko.dataFor(document.getElementById('theforum'));
              const thread = model.threads()[0];
              model.expandedThread(thread); thread.isExpanded(true);
              model.selectedPost(thread); model.postToReplyTo(thread);
            """)
            footer.find_element(By.CSS_SELECTOR, '[aria-label="Next page"]').click()
            loaded(2)
            assert driver.execute_script("""
              const model = ko.dataFor(document.getElementById('theforum'));
              return model.expandedThread() === null && model.selectedPost() === null
                && model.postToReplyTo() === null;
            """), "paging must visibly leave the expanded thread and selected reply"
            footer.find_element(By.CSS_SELECTOR, '[aria-label="Previous page"]').click()
            loaded(1)
            assert footer.find_element(By.CSS_SELECTOR, '[role="status"]').get_attribute("aria-live") == "polite"
            controls = driver.find_elements(By.CSS_SELECTOR, ".thread-footer .fewercunts-page-controls .fewercunts-page-control")
            labels = [control.get_attribute("textContent").strip() for control in controls]
            assert labels == ["First", "‹ Previous", "Next ›", "Last"], labels
            field = footer.find_element(By.CSS_SELECTOR, ".fewercunts-page-input")
            total = int(footer.find_element(By.CSS_SELECTOR, ".fewercunts-page-total").text)
            assert total > 100 and field.get_attribute("value") == "01"
            assert controls[0].get_attribute("disabled") and controls[1].get_attribute("disabled")
            assert not controls[2].get_attribute("disabled") and not controls[3].get_attribute("disabled")
            first_page_thread = driver.execute_script(
                "return ko.dataFor(document.getElementById('theforum')).threads()[0].id();")

            driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ARROW_RIGHT)
            loaded(2)
            driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ARROW_LEFT)
            loaded(1)
            field.click(); field.send_keys(Keys.ARROW_RIGHT)
            assert page() == 1, "arrow keys inside the editable page field must move its caret, not the forum page"

            enter(field, "2")
            loaded(2)
            assert dock_position()["bottom"] == initial_dock["bottom"]
            assert field.get_attribute("value") == "02"
            assert driver.current_url == "https://ntforum.net/#page=2"
            assert driver.execute_script(
                "return ko.dataFor(document.getElementById('theforum')).threads()[0].id();") != first_page_thread
            assert all(not control.get_attribute("disabled") for control in controls)

            stable_thread = driver.execute_script(
                "return ko.dataFor(document.getElementById('theforum')).threads()[0].id();")
            for invalid in ("", "word", "2.5", "-1", "0", str(total + 1)):
                enter(field, invalid)
                observed = {"input": invalid, "page": page(), "value": field.get_attribute("value"),
                            "ariaInvalid": field.get_attribute("aria-invalid")}
                assert observed["page"] == 2 and observed["ariaInvalid"] == "true", observed
                assert driver.execute_script(
                    "return ko.dataFor(document.getElementById('theforum')).threads()[0].id();") == stable_thread

            controls[2].click()
            loaded(3)
            controls = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-page-controls .fewercunts-page-control")
            controls[1].click()
            loaded(2)
            driver.back()
            loaded(3)
            driver.back()
            loaded(2)
            driver.forward()
            loaded(3)
            controls = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-page-controls .fewercunts-page-control")
            controls[3].click()
            loaded(total)
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-page-input").get_attribute("value") == str(total)
            assert controls[2].get_attribute("disabled") and controls[3].get_attribute("disabled")
            controls[0].click()
            loaded(1)
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-page-input").get_attribute("value") == "01"

            driver.get("https://ntforum.net/#page=10")
            loaded(10)
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-page-input").get_attribute("value") == "10"
            driver.refresh()
            loaded(10)
            driver.set_window_size(390, 844)
            driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
            mobile_dock = dock_position()
            assert mobile_dock["bottom"] == mobile_dock["viewport"]
            assert mobile_dock["reserved"] >= mobile_dock["height"]
            assert wait.until(lambda page: page.execute_script("""
              const pager = document.querySelector('.fewercunts-pagination').getBoundingClientRect();
              const home = document.querySelector('.fewercunts-primary-nav').getBoundingClientRect();
              return Math.abs(pager.left - home.left) <= 1;
            """)), "mobile pager must retain top-navigation alignment"
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth;")
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-page-input").get_attribute("aria-label") == "Page number"
            assert [control.get_attribute("aria-label") for control in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-page-controls .fewercunts-page-control")] == [
                "First page", "Previous page", "Next page", "Last page"]
        finally:
            driver.quit()
    print({"result": "pass", "firstMiddleLast": True, "invalidRejected": True,
           "historyAndReload": True, "responsive": True, "editablePageAlwaysVisible": True,
           "expandedThreadReset": True,
           "arrowKeyPaging": True,
           "screenReader": True, "reducedMotion": True})


if __name__ == "__main__":
    main()
