#!/usr/bin/env python3
"""Exercise the opt-in search alpha in a real Chromium extension profile."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
import re
import tempfile
import time

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as conditions
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.common.exceptions import TimeoutException

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-search-chromium-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-gpu")
        options.add_argument(f"--user-data-dir={profile}")
        options.add_argument(f"--disable-extensions-except={ROOT}")
        options.add_argument(f"--load-extension={ROOT}")
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        try:
            driver.get("https://ntforum.net/")
            wait = WebDriverWait(driver, 60)
            def visible_search(page):
                candidate = page.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']")
                return candidate if candidate.is_displayed() and candidate.is_enabled() else False

            def complete_navigation(page):
                items = page.find_elements(By.CSS_SELECTOR, ".fewercunts-primary-nav > .fewercunts-top-nav, .fewercunts-primary-nav > .fewercunts-menu > .fewercunts-top-nav")
                return items if [item.text for item in items] == ["Home", "User", "New Topic", "View", "Search", "About"] else False

            top_navigation = wait.until(complete_navigation)
            assert [item.text for item in top_navigation] == ["Home", "User", "New Topic", "View", "Search", "About"]
            wait.until(lambda page: page.current_url == "https://ntforum.net/")
            wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-native-threads .thread-header")))
            native_link = wait.until(conditions.element_to_be_clickable((By.CSS_SELECTOR, ".fewercunts-native-threads .thread-header a[href*='/thread/']")))
            native_title = native_link.text
            native_thread_id = int(re.search(r"/thread/(\d+)", native_link.get_attribute("href")).group(1))
            assert native_title and native_thread_id > 0
            title_cell = native_link.find_element(By.XPATH, "..")
            compact_actions = wait.until(lambda page: title_cell.find_elements(By.CSS_SELECTOR, ".fewercunts-thread-actions > button"))
            assert [item.text for item in compact_actions] == ["S", "M"]
            assert [item.get_attribute("data-action-label") for item in compact_actions] == ["Save", "Mute"]
            assert all(item.get_attribute("aria-label") for item in compact_actions)
            assert driver.execute_script("const p=arguments[0].getBoundingClientRect(),a=arguments[1].getBoundingClientRect(); return Math.abs((p.right-7)-a.right)<=1", title_cell, compact_actions[0].find_element(By.XPATH, ".."))
            theme_match = driver.execute_script("""
              const reference = getComputedStyle(document.querySelector('.post-title'));
              const top = getComputedStyle(arguments[0]);
              const bar = getComputedStyle(document.querySelector('.fewercunts-primary-nav'));
              return ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color']
                .every(property => top[property] === reference[property])
                && bar.backgroundColor === reference.backgroundColor;
            """, top_navigation[0])
            assert theme_match, "top navigation must inherit the native post-title visual language"
            native_link.click()
            wait.until(lambda page: page.execute_script("const vm=ko.dataFor(document.getElementById('theforum')); return vm.expandedThread() && vm.expandedThread().id();") == native_thread_id)
            assert driver.find_element(By.CSS_SELECTOR, f".fewercunts-native-threads .thread-header a[href*='/thread/{native_thread_id}']").text == native_title
            driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Home']").click()
            wait.until(lambda page: page.current_url == "https://ntforum.net/")
            search_navigation = driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']")
            assert search_navigation.get_attribute("aria-expanded") == "false"
            assert not driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-form").is_displayed()
            search_navigation.click()
            assert search_navigation.get_attribute("aria-expanded") == "true"
            search = wait.until(visible_search)
            assert search.get_attribute("placeholder") == "Search the forum"
            assert search.find_element(By.XPATH, "ancestor::form").get_attribute("role") == "search"
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-form .fewercunts-search-submit").text == "Search"
            scope_buttons = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-scope-button")
            assert [button.text for button in scope_buttons] == ["User", "Post", "Replies"]
            assert all(button.get_attribute("aria-pressed") == "true" for button in scope_buttons)
            scope_buttons[0].click()
            assert scope_buttons[0].get_attribute("aria-pressed") == "false"
            scope_buttons[0].click()
            assert scope_buttons[0].get_attribute("aria-pressed") == "true"
            pause_control = driver.find_element(By.CSS_SELECTOR, ".fewercunts-index-button:first-child")
            update_control, clear_control = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-index-button")[1:3]
            assert pause_control.text == "Pause index"
            assert pause_control.get_attribute("data-phase") not in ("paused", "disabled")
            assert clear_control.text == "Clear index"
            assert update_control.text == "Update now"
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-auto-update").is_selected()
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-refresh-interval").get_attribute("value") == "15"
            assert "posts" in driver.find_element(By.CSS_SELECTOR, ".fewercunts-storage-status").text
            user_navigation = driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='User']")
            user_navigation.click()
            user_items = driver.find_elements(By.XPATH, "//button[(@role='menuitem' or @role='menuitemradio') and ancestor::*[contains(@class,'fewercunts-menu')][.//button[normalize-space()='User']]]")
            assert [item.text for item in user_items] == ["Create Account", "Change Password", "Block list",
                                                        "Notifications", "Mark forum unread", "Export settings",
                                                        "Import settings", "Logout"]
            assert not driver.find_elements(By.CSS_SELECTOR, "[role='menuitemradio'], [data-theme-mode]")
            assert all(item.is_displayed() for item in user_items)
            assert driver.execute_script("""
              const reference = getComputedStyle(document.querySelector('.post-title'));
              const nested = getComputedStyle(arguments[0]);
              return ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight'].every(property => nested[property] === reference[property]);
            """, user_items[1]), "nested navigation must use native section typography"
            user_items[2].click()
            wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-block-list-form")))
            assert [item.text for item in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-block-list-name")] == ["Soulisdead", "monkeybutler"]
            block_input = driver.find_element(By.CSS_SELECTOR, ".fewercunts-block-list-input")
            block_input.send_keys("  Example User  ")
            driver.find_element(By.CSS_SELECTOR, ".fewercunts-block-list-form .fewercunts-search-submit").click()
            wait.until(lambda page: page.execute_script("return Array.from(document.querySelectorAll('.fewercunts-block-list-name')).some(node => node.textContent === 'Example User')"))
            driver.find_element(By.XPATH, "//button[@aria-label='Remove Example User from blocked users']").click()
            wait.until(lambda page: page.execute_script("return !Array.from(document.querySelectorAll('.fewercunts-block-list-name')).some(node => node.textContent === 'Example User')"))
            driver.find_element(By.XPATH, "//button[normalize-space()='Reset defaults']").click()
            user_navigation.click()
            driver.find_element(By.XPATH, "//button[@role='menuitem' and normalize-space()='Change Password']").click()
            assert driver.execute_script("return ko.dataFor(document.getElementById('theforum')).isShowingPasswordResetForm();") is True
            home_navigation = driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Home']")
            home_navigation.click()
            driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='New Topic']").click()
            assert driver.execute_script("return ko.dataFor(document.getElementById('theforum')).isShowingNewPostForm();") is True
            home_navigation.click()

            assert search_navigation.get_attribute("aria-expanded") == "false"
            search_navigation.click()
            search = wait.until(visible_search)
            search_form = search.find_element(By.XPATH, "ancestor::form")
            search_form.find_element(By.CSS_SELECTOR, ".fewercunts-search-submit").click()
            empty_status = wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-search-status-empty")))
            assert empty_status.get_attribute("role") == "status"
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-results").get_attribute("data-state") == "empty"

            scope_buttons = search_form.find_elements(By.CSS_SELECTOR, ".fewercunts-scope-button")
            for button in scope_buttons:
                if button.get_attribute("aria-pressed") != "true":
                    button.click()
            assert all(button.get_attribute("aria-pressed") == "true" for button in scope_buttons)

            search.send_keys(Keys.CONTROL, "a", Keys.BACKSPACE)
            search.send_keys("GTA")
            assert search.get_attribute("value") == "GTA"
            assert driver.execute_script("return arguments[0].dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));", search_form) is False
            consent_required = False
            try:
                WebDriverWait(driver, 2).until(conditions.alert_is_present()).accept()
                consent_required = True
            except TimeoutException:
                pass

            try:
                WebDriverWait(driver, 90).until(lambda page: page.execute_script("""
                  const progressing = Array.from(document.querySelectorAll('.fewercunts-search-status-loading, .fewercunts-search-status-progress')).some(status => {
                    const progress = status.querySelector('.fewercunts-search-progress');
                    return status.getClientRects().length && status.getAttribute('role') === 'status'
                      && progress && progress.getAttribute('aria-label');
                  });
                  const completed = Array.from(document.querySelectorAll('.fewercunts-search-results[data-state="results"]'))
                    .some(panel => panel.getClientRects().length && panel.querySelector('.fewercunts-result'));
                  return progressing || completed;
                """))
            except TimeoutException as error:
                diagnostic = driver.execute_script("""
                  return {phase: document.querySelector('.fewercunts-index-button')?.dataset.phase,
                    state: Array.from(document.querySelectorAll('.fewercunts-search-results')).map(node => node.dataset.state),
                    statuses: Array.from(document.querySelectorAll('.fewercunts-search-status')).map(node => node.textContent),
                    results: document.querySelectorAll('.fewercunts-result').length};
                """)
                raise AssertionError(f"Search did not enter its loading/progress state: {diagnostic}") from error

            time.sleep(2)
            def visible_index_button(text):
                return next((button for button in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-index-button")
                             if button.is_displayed() and button.is_enabled() and button.text == text), False)
            wait.until(lambda _page: visible_index_button("Pause index")).click()
            pause_outcome = WebDriverWait(driver, 180).until(lambda page:
                visible_index_button("Resume index") or next((button for button in page.find_elements(
                    By.CSS_SELECTOR, ".fewercunts-index-button") if button.is_displayed()
                    and button.get_attribute("data-phase") == "complete"), False))
            if pause_outcome.text == "Resume index":
                pause_outcome.click()
                wait.until(lambda page: visible_index_button("Pause index") or next((button for button in page.find_elements(
                    By.CSS_SELECTOR, ".fewercunts-index-button") if button.is_displayed()
                    and button.get_attribute("data-phase") == "complete"), False))
            wait.until(conditions.element_to_be_clickable((By.XPATH,
                "//div[contains(@class,'fewercunts-search-tabs')]//button[normalize-space()='Replies']"))).click()
            wait.until(lambda page: page.find_element(By.CSS_SELECTOR,
                ".fewercunts-search-tabs [aria-selected='true']").text == "Replies")

            wait.until(lambda page: next((button for button in page.find_elements(
                By.CSS_SELECTOR, ".fewercunts-index-button") if button.is_displayed()
                and button.get_attribute("data-phase") == "complete"), False))
            search = driver.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']")
            search.send_keys(Keys.ENTER)
            wait.until(conditions.element_to_be_clickable((By.XPATH,
                "//div[contains(@class,'fewercunts-search-tabs')]//button[normalize-space()='Replies']"))).click()
            try:
                wait.until(lambda page: page.execute_script(
                    "return [...document.querySelectorAll('.fewercunts-result a[data-fewercunts-doc-key]')]"
                    ".some(link => link.getClientRects().length)"))
                links = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-result a[data-fewercunts-doc-key]")
            except TimeoutException as error:
                diagnostic = driver.execute_script("""
                  return {url: location.href,
                    selected: document.querySelector('.fewercunts-search-tabs [aria-selected="true"]')?.textContent,
                    status: [...document.querySelectorAll('.fewercunts-search-status')]
                      .filter(node => node.getClientRects().length).map(node => node.textContent),
                    state: document.querySelector('.fewercunts-search-results:not([hidden])')?.dataset.state,
                    rows: [...document.querySelectorAll('.fewercunts-result')].map(row => ({
                      display: getComputedStyle(row).display, visibility: getComputedStyle(row).visibility,
                      rect: row.getBoundingClientRect().toJSON(), html: row.outerHTML.slice(0, 500)})),
                    panel: (() => { const node=document.querySelector('.fewercunts-search-results:not([hidden])');
                      return node && {rect:node.getBoundingClientRect().toJSON(), overflow:getComputedStyle(node).overflow,
                        maxHeight:getComputedStyle(node).maxHeight}; })()};
                """)
                raise AssertionError(f"stable Replies search rendered no result: {diagnostic}") from error
            status = driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-status").text
            assert "result" in status and "GTA" in status
            assert next(button for button in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-index-button")
                        if button.is_displayed()).get_attribute("data-phase") == "complete"
            assert all(link.get_attribute("href").startswith("https://ntforum.net/thread/") for link in links)
            results = wait.until(lambda page: ([result for result in page.find_elements(
                By.CSS_SELECTOR, ".fewercunts-result") if result.is_displayed()] or False))
            assert results[0].find_element(By.XPATH, "ancestor::*[contains(@class,'fewercunts-search-results')]").get_attribute("data-state") == "results"
            assert [node.text for node in driver.find_elements(
                By.CSS_SELECTOR, ".fewercunts-search-header > div")] == ["Size", "Subject", "From", "When"]
            assert [tab.text for tab in driver.find_elements(
                By.CSS_SELECTOR, ".fewercunts-search-tabs [role='tab']")] == ["Posts", "Replies"]
            assert all(result.find_element(By.CSS_SELECTOR, ".fewercunts-result-reply").get_attribute("textContent").strip() == "Reply" for result in results)
            assert all(result.find_element(By.CSS_SELECTOR, "a[data-fewercunts-doc-key]").get_attribute("href").startswith("https://ntforum.net/thread/") for result in results)

            driver.set_window_size(390, 844)
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-form .fewercunts-search-submit").is_displayed()
            assert all(button.is_displayed() for button in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-scope-button"))
            driver.set_window_size(1280, 900)

            driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {
                "features": [{"name": "prefers-reduced-motion", "value": "reduce"}]
            })
            visit_url = driver.execute_script("""
              const node = Array.from(document.querySelectorAll('.fewercunts-result a[data-fewercunts-doc-key]'))
                .find(candidate => candidate.getClientRects().length);
              if (!node) return null; const href = node.href; node.click(); return href;
            """)
            assert visit_url
            visit_target_id = int(re.search(r"/reply/(\d+)", visit_url).group(1)) if "/reply/" in visit_url else int(re.search(r"/thread/(\d+)", visit_url).group(1))
            try:
                wait.until(lambda page: page.execute_script("const vm=ko.dataFor(document.getElementById('theforum')); return vm.selectedPost() && vm.selectedPost().id();") == visit_target_id)
            except TimeoutException as error:
                diagnostic = driver.execute_script("""
                  const vm=ko.dataFor(document.getElementById('theforum'));
                  return {url: location.href, selected: vm.selectedPost() && vm.selectedPost().id(),
                    expanded: vm.expandedThread() && vm.expandedThread().id(),
                    statuses: Array.from(document.querySelectorAll('.fewercunts-search-status')).map(node => node.textContent)};
                """)
                raise AssertionError(f"Visit did not select {visit_target_id} from {visit_url}: {diagnostic}") from error
            wait.until(lambda page: page.current_url == visit_url)
            marks = wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".post-container mark.fewercunts-match"))
            assert marks and all(mark.get_attribute("textContent") for mark in marks)
            assert all(driver.execute_script("return getComputedStyle(arguments[0]).animationName", mark) == "none" for mark in marks)
            assert driver.execute_script("""
              const node = document.querySelector('#theforum .post-container .post-title');
              const post = node && ko.dataFor(node);
              return post && post.id();
            """) == visit_target_id
            assert not any(name in driver.find_element(By.CSS_SELECTOR, ".post-container").text.lower()
                           for name in ("soulisdead", "monkeybutler"))
            wait.until(lambda page: not page.find_elements(By.CSS_SELECTOR, ".post-container mark.fewercunts-match"))
            driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"features": []})

            assert "fewercunts-search-form" in driver.page_source
            home = driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Home']")
            home.click()
            wait.until(lambda page: page.current_url == "https://ntforum.net/")
            assert wait.until(lambda page: page.execute_script("""
              return [...document.querySelectorAll(".fewercunts-native-threads a[href*='/thread/15249']")]
                .find(link => link.getClientRects().length && link.textContent.trim())?.textContent.trim() || null;
            """)) == "Welcome to godMode"
            assert not driver.find_element(By.CSS_SELECTOR, ".fewercunts-search-results").is_displayed()
            assert search_navigation.get_attribute("aria-expanded") == "false"
            assert not search_form.is_displayed()

            def click_visible_native_author(page):
                return page.execute_script("""
                  const candidate = Array.from(document.querySelectorAll('.fewercunts-native-threads .thread-header > .col-xs-2 [data-fewercunts-author]'))
                    .find(node => node.offsetParent !== null);
                  if (!candidate) return false;
                  const username = candidate.textContent.trim();
                  candidate.click();
                  return username;
                """)

            author_name = wait.until(click_visible_native_author)
            wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-author-header")))
            author_rows = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-author-thread")
            assert all(row.find_element(By.CSS_SELECTOR, ".col-xs-2 [data-fewercunts-author]").text.strip() == author_name for row in author_rows)
            author_tabs = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-author-tab")
            assert [tab.text for tab in author_tabs] == ["Posts", "Replies"]
            assert all(tab.get_attribute("role") == "tab" for tab in author_tabs)
            assert [tab.get_attribute("aria-selected") for tab in author_tabs] == ["true", "false"]
            author_tabs[1].click()
            wait.until(lambda page: (tabs := page.find_elements(By.CSS_SELECTOR, ".fewercunts-author-tab")) and len(tabs) == 2 and tabs[1].get_attribute("aria-selected") == "true")
            author_replies = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-author-reply")
            if author_replies:
                assert all(row.find_element(By.CSS_SELECTOR, ".fewercunts-result-reply").get_attribute("textContent").strip() == "Reply" for row in author_replies)
                assert all("/reply/" in row.find_element(By.CSS_SELECTOR, ".post-title a").get_attribute("href") for row in author_replies)

            home = driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Home']")
            home.click()
            view = driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='View']")
            view.click()
            view_items = driver.find_elements(By.XPATH, "//button[@role='menuitem' and ancestor::*[contains(@class,'fewercunts-menu')][.//button[normalize-space()='View']]]")
            assert [item.text for item in view_items] == ["Classic", "Unread", "Saved", "Muted", "Unloved"]
            unloved = driver.find_element(By.XPATH, "//button[@role='menuitem' and normalize-space()='Unloved']")
            assert unloved.text == "Unloved"
            unloved.click()
            wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-unloved-header")))
            unloved_rows = driver.find_elements(By.CSS_SELECTOR, ".fewercunts-unloved-thread")
            assert unloved_rows, "the populated signed catalogue must expose indexed unloved threads"
            unloved_rows_control = Select(driver.find_element(By.CSS_SELECTOR, ".fewercunts-rows-select"))
            assert unloved_rows_control.first_selected_option.get_attribute("value") == "auto"
            unloved_effective = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, ".fewercunts-rows-status").text
                                           if re.fullmatch(r"\(\d+\)", page.find_element(By.CSS_SELECTOR, ".fewercunts-rows-status").text) else False)
            assert len(unloved_rows) <= int(unloved_effective.strip("()"))
            assert all(row.find_element(By.CSS_SELECTOR, ".col-xs-1").text == "1" for row in unloved_rows)
            unloved_dates = [row.find_elements(By.CSS_SELECTOR, ".col-xs-2")[-1].text for row in unloved_rows]
            date_key = lambda value: datetime.strptime(value, "%m/%d/%Y")
            assert unloved_dates == sorted(unloved_dates, key=date_key)
            unloved_target = unloved_rows[0].find_element(By.CSS_SELECTOR, ".col-xs-6 a")
            unloved_url = unloved_target.get_attribute("href")
            unloved_target.click()
            wait.until(lambda page: page.current_url == unloved_url)

            driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Home']").click()
            driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Search']").click()
            search = wait.until(visible_search)
            search.send_keys(Keys.CONTROL, "a", Keys.BACKSPACE)
            search.send_keys("GTA")
            search.send_keys(Keys.ENTER)
            wait.until(conditions.element_to_be_clickable((By.XPATH,
                "//div[contains(@class,'fewercunts-search-tabs')]//button[normalize-space()='Replies']"))).click()
            reply_url = wait.until(lambda page: page.execute_script("""
              const reply = Array.from(document.querySelectorAll('.fewercunts-result-reply'))
                .find(node => node.getClientRects().length);
              return reply?.closest('article')?.querySelector('a[data-fewercunts-doc-key]')?.href || null;
            """))
            reply_target_id = int(re.search(r"/reply/(\d+)", reply_url).group(1)) if "/reply/" in reply_url else int(re.search(r"/thread/(\d+)", reply_url).group(1))
            # Search status refreshes can replace the result list. Locate and activate the
            # exact captured result atomically so the verifier does not retain a stale node.
            assert driver.execute_script("""
              const url = arguments[0];
              const visit = Array.from(document.querySelectorAll('.fewercunts-result a[data-fewercunts-doc-key]'))
                .find(node => node.href === url);
              const reply = visit && visit.closest('article')?.querySelector('.fewercunts-result-reply');
              if (!reply) return false;
              reply.click();
              return true;
            """, reply_url)
            try:
                wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".new-post-header")))
            except TimeoutException as error:
                state = driver.execute_script("const vm=ko.dataFor(document.getElementById('theforum')); return {selected:vm.selectedPost()&&vm.selectedPost().id(), target:vm.postToReplyTo()&&vm.postToReplyTo().id(), form:vm.isShowingNewPostForm()};")
                statuses = [node.text for node in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-search-status") if node.is_displayed()]
                raise AssertionError(f"exact reply did not open: state={state}, status={statuses}") from error
            assert driver.execute_script("const vm=ko.dataFor(document.getElementById('theforum')); return vm.postToReplyTo() && vm.postToReplyTo().id();") == reply_target_id

            driver.execute_script("""
              document.dispatchEvent(new CustomEvent('fewercunts:navigate-to-post', {detail: JSON.stringify({
                requestId: 'old-thread-live-check', reply: false, targetPostId: 246782,
                thread: {Id:11258, Title:'Andrew Tate', Message:'', PostedByUsername:'RVD',
                  PostedByEmailAddress:'', CreatedDateTimeUtc:'2023-08-31T20:41:34Z',
                  LastPostDateTimeUtc:'2025-11-25T15:28:23.067Z', PostCount:59}
              })}));
            """)
            wait.until(lambda page: page.execute_script("const vm=ko.dataFor(document.getElementById('theforum')); return vm.selectedPost() && vm.selectedPost().id();") == 246782)
            wait.until(lambda page: page.current_url == "https://ntforum.net/thread/11258/reply/246782")

            archive_state = driver.execute_script("""
              const vm = ko.dataFor(document.getElementById('theforum'));
              const thread = vm.expandedThread();
              const selected = vm.selectedPost();
              vm.isShowingNewPostForm(false);
              vm.postToReplyTo(null);
              thread.postCount(1000);
              document.getElementById('theforum').appendChild(document.createComment('archive-boundary'));
              const opened = vm.showReplyForm(selected);
              return {opened, form: vm.isShowingNewPostForm(), target: vm.postToReplyTo()};
            """)
            assert archive_state == {"opened": False, "form": False, "target": None}
            archived = wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-native-archived")))
            assert archived.tag_name == "span"
            assert archived.text == "Archived"
            assert archived.get_attribute("aria-label") == "Thread archived; replies are closed"

            for adjacent_post_count in (999, 1001):
                driver.execute_script("""
                  const vm = ko.dataFor(document.getElementById('theforum'));
                  vm.expandedThread().postCount(arguments[0]);
                  document.getElementById('theforum').appendChild(document.createComment('archive-adjacent'));
                """, adjacent_post_count)
                wait.until(lambda page: not page.find_elements(By.CSS_SELECTOR, ".fewercunts-native-archived"))
                assert any(node.text.strip() == "Reply" for node in driver.find_elements(By.CSS_SELECTOR, ".post-reply-button > .link-text"))
            print(json.dumps({
                "result": "pass",
                "browser": driver.capabilities["browserVersion"],
                "query": "GTA",
                "visibleResults": len(links),
                "status": status,
                "consentRequired": consent_required,
                "threadsNavigationRestored": True,
                "authorThreadView": author_name,
                "authorActivityTabs": ["Posts", "Replies"],
                "unlovedNavigation": True,
                "userMenu": ["Create Account", "Change Password", "Notifications", "Logout"],
                "topNavigation": ["Home", "User", "New Topic", "View", "Search", "About"],
                "searchProgressiveDisclosure": True,
                "replyWorkflowActivated": True,
                "exactReplyTargetId": reply_target_id,
                "exactVisitTargetId": visit_target_id,
                "historicalReplyTargetId": 246782,
                "resultActions": ["Reply", "Visit"],
                "searchScopes": ["User", "Post", "Replies"],
                "pauseResumeControls": True,
                "storageProgressVisible": True,
                "uiStates": ["empty", "loading", "progress", "results", "error"],
                "responsiveViewport": "390x844",
                "semanticStatusRoles": True,
                "archiveBoundary": {"replies": 999, "postCount": 1000, "adjacentPostCountsOpen": [999, 1001]},
            }, sort_keys=True))
        finally:
            driver.quit()


if __name__ == "__main__":
    main()
