#!/usr/bin/env python3
"""Verify the exact 999-reply archive boundary in the native forum UI."""

from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-archived-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu",
                         f"--user-data-dir={profile}", f"--disable-extensions-except={ROOT}",
                         f"--load-extension={ROOT}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=.2)
        try:
            driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
                "source": "try { localStorage.setItem('fewercunts.rows-per-page','25'); } catch (_) {}"
            })
            driver.get("https://ntforum.net/")
            wait.until(lambda page: page.execute_script("return Boolean(window.ko && ko.dataFor(document.getElementById('theforum'))?.threads()?.length)"))
            wait.until(lambda page: page.current_url == "https://ntforum.net/")

            def select_with_post_count(post_count):
                driver.execute_script("""
                  const vm = ko.dataFor(document.getElementById('theforum'));
                  const thread = vm.threads()[0];
                  vm.isShowingNewPostForm(false);
                  thread.postCount(arguments[0]);
                  vm.expandedThread(null);
                  vm.expandedThread(thread);
                  vm.selectPost(thread);
                  thread.isExpanded(true);
                """, post_count)

            select_with_post_count(1000)
            archived = wait.until(lambda page: (items := [item for item in page.find_elements(By.CSS_SELECTOR, ".post-reply-button .fewercunts-native-archived") if item.is_displayed()]) and items[0])
            assert archived.text == "Archived"
            assert archived.tag_name == "span"
            assert archived.get_attribute("aria-label") == "Thread archived; replies are closed"
            assert archived.get_attribute("role") is None
            assert archived.get_attribute("tabindex") is None
            assert driver.execute_script("""
              const style = getComputedStyle(arguments[0]);
              const probe = document.createElement('span');
              probe.style.color = 'var(--muted-accent-color)';
              arguments[0].parentElement.appendChild(probe);
              const themedColor = getComputedStyle(probe).color;
              probe.remove();
              return style.cursor === 'default' && style.textDecorationLine === 'none'
                && style.color === themedColor;
            """, archived), "Archived text must use the current forum theme's muted accent"
            driver.set_window_size(390, 844)
            assert archived.is_displayed()
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            driver.set_window_size(1280, 900)
            assert driver.execute_script("""
              const vm = ko.dataFor(document.getElementById('theforum'));
              const returned = vm.showReplyForm(vm.selectedPost());
              return returned === false && !vm.isShowingNewPostForm() && vm.postToReplyTo() == null;
            """), "native reply handler must refuse an archived thread"

            for adjacent_post_count in (999, 1001):
                select_with_post_count(adjacent_post_count)
                reply = wait.until(lambda page: (items := page.find_elements(By.CSS_SELECTOR, ".post-reply-button .link-text:not(.fewercunts-archived)")) and items[0])
                assert reply.text == "Reply"
                assert driver.execute_script("""
                  const vm = ko.dataFor(document.getElementById('theforum'));
                  vm.showReplyForm(vm.selectedPost());
                  const opened = vm.isShowingNewPostForm() && vm.postToReplyTo() === vm.selectedPost();
                  vm.isShowingNewPostForm(false);
                  return opened;
                """), f"PostCount {adjacent_post_count} must remain replyable"
        finally:
            driver.quit()
    print({"result": "pass", "archivedReplies": 999, "archivedPostCount": 1000,
           "adjacentCountsReplyable": True, "nativeHandlerGuarded": True,
           "accessibleText": True, "themeAndMobile": True})


if __name__ == "__main__":
    main()
