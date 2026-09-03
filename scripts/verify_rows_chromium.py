#!/usr/bin/env python3
"""Verify responsive and persistent Rows controls against the live forum model."""

from pathlib import Path
import re
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as conditions
from selenium.webdriver.support.ui import Select, WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-rows-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu",
                         f"--user-data-dir={profile}", f"--disable-extensions-except={ROOT}",
                         f"--load-extension={ROOT}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 240, poll_frequency=0.2)
        try:
            driver.set_window_size(1280, 600)
            driver.get("https://ntforum.net/")
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select"))
            wait.until(lambda page: page.find_element(By.TAG_NAME, "html").get_attribute("data-fewercunts-startup") == "ready")
            wait.until(lambda page: not page.execute_script(
                "return ko.dataFor(document.getElementById('theforum')).isLoadingThreads();"))
            select = Select(driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select"))
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select").is_displayed()
            assert len([item for item in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-rows-control") if item.is_displayed()]) == 1
            assert driver.execute_script("""
              const rows = getComputedStyle(document.querySelector('.fewercunts-rows-control'));
              const home = getComputedStyle(document.querySelector('.fewercunts-primary-nav > .fewercunts-top-nav'));
              return ['fontFamily','fontSize','fontWeight','lineHeight','color'].every(name => rows[name] === home[name]);
            """), "Rows must use the same native top-navigation typography"
            assert select.first_selected_option.get_attribute("value") == "auto"
            auto_status = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, ".fewercunts-rows-status").text
                                     if re.fullmatch(r"\(\d+\)", page.find_element(By.CSS_SELECTOR, ".fewercunts-rows-status").text) else False)
            auto_rows = int(auto_status.strip("()"))
            wait.until(lambda page: page.execute_script(
                "return ko.dataFor(document.getElementById('theforum')).pageSize();") == auto_rows)
            wait.until(lambda page: page.execute_script(
                "return ko.dataFor(document.getElementById('theforum')).threads().length;") == auto_rows)
            catalogue = driver.execute_script("""
              const vm=ko.dataFor(document.getElementById('theforum'));
              return {pageSize:vm.pageSize(), threads:vm.threads().length, total:vm.threadCount(), pages:vm.totalPages()};
            """)
            assert catalogue["pageSize"] == auto_rows and catalogue["threads"] == auto_rows
            assert catalogue["total"] > 25
            assert catalogue["pages"] == (catalogue["total"] + auto_rows - 1) // auto_rows
            assert driver.execute_script("""
              const panel = document.querySelector('.forum-right-side');
              const panelBottom = panel.getBoundingClientRect().bottom;
              const rows = [...document.querySelectorAll('.thread-header')]
                .filter(row => row.getClientRects().length);
              const complete = rows.filter(row => row.getBoundingClientRect().top >= panel.getBoundingClientRect().top
                && row.getBoundingClientRect().bottom <= panelBottom + 1);
              return rows.length === arguments[0] && complete.length === arguments[0]
                && Math.abs(panelBottom - document.querySelector('.fewercunts-pagination').getBoundingClientRect().top) <= 1;
            """, auto_rows), "Auto must make the complete local catalogue use exactly the whole rows that fit"

            driver.execute_script("""
              const vm = ko.dataFor(document.getElementById('theforum'));
              const thread = vm.threads()[0];
              vm.expandedThread(thread);
              thread.isExpanded(true);
              const replyTree = document.createElement('div');
              replyTree.id = 'fewercunts-large-thread-fixture';
              replyTree.style.height = '1200px';
              document.querySelector('.forum-right-side').appendChild(replyTree);
            """)
            assert wait.until(lambda page: page.execute_script("""
              const panel = document.querySelector('.forum-right-side');
              const replyTree = document.getElementById('fewercunts-large-thread-fixture');
              return !panel.classList.contains('fewercunts-density-scroll')
                && panel.style.height === ''
                && getComputedStyle(panel).overflowY !== 'hidden'
                && replyTree.getBoundingClientRect().height === 1200;
            """)), "expanded reply trees must escape the list viewport and scroll normally"
            driver.execute_script("""
              document.getElementById('fewercunts-large-thread-fixture').remove();
              const vm = ko.dataFor(document.getElementById('theforum'));
              vm.expandedThread(null);
            """)
            assert wait.until(lambda page: page.execute_script("""
              const panel = document.querySelector('.forum-right-side');
              return panel.classList.contains('fewercunts-density-scroll') && panel.style.height !== '';
            """)), "collapsing a thread must restore the selected list density"

            Select(driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select")).select_by_value("10")
            wait.until(lambda page: page.execute_script("""
              const panel=document.querySelector('.forum-right-side'), bottom=panel.getBoundingClientRect().bottom;
              return [...panel.querySelectorAll('.thread-header')].filter(row => row.getBoundingClientRect().bottom <= bottom + 1).length === 10;
            """))
            wait.until(lambda page: page.execute_script(
                "return ko.dataFor(document.getElementById('theforum')).pageSize();") == 10)
            assert driver.execute_script("return ko.dataFor(document.getElementById('theforum')).threads().length;") == 10
            assert driver.execute_script("""
              const vm=ko.dataFor(document.getElementById('theforum'));
              return vm.totalPages() === Math.ceil(vm.threadCount()/10);
            """)
            assert driver.execute_script("return localStorage.getItem('fewercunts.rows-per-page');") == "10"
            driver.refresh()
            wait.until(lambda page: Select(page.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select")).first_selected_option.get_attribute("value") == "10")
            wait.until(lambda page: page.find_element(By.TAG_NAME, "html").get_attribute("data-fewercunts-startup") == "ready")
            assert Select(driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select")).first_selected_option.get_attribute("value") == "10"

            Select(driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select")).select_by_value("auto")
            driver.set_window_size(390, 844)
            mobile_status = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, ".fewercunts-rows-status").text
                                       if re.fullmatch(r"\(\d+\)", page.find_element(By.CSS_SELECTOR, ".fewercunts-rows-status").text)
                                       and page.find_element(By.CSS_SELECTOR, ".fewercunts-rows-status").text != auto_status else False)
            mobile_rows = int(mobile_status.strip("()"))
            assert 1 <= mobile_rows <= 50
            assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth;")
            assert driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select").get_attribute("aria-label") == "Rows visible in Classic"
            driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='View']").click()
            driver.find_element(By.XPATH, "//button[@role='menuitem' and normalize-space()='Unloved']").click()
            wait.until(lambda page: page.current_url.endswith("#view=unloved"))
            wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-unloved-header")))
            assert len([item for item in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-control") if item.is_displayed()]) == 1
            unloved_select = Select(driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select"))
            assert unloved_select.first_selected_option.get_attribute("value") == "auto"
            unloved_auto = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, ".fewercunts-rows-status").text
                                      if re.fullmatch(r"\(\d+\)", page.find_element(By.CSS_SELECTOR, ".fewercunts-rows-status").text) else False)
            assert int(unloved_auto.strip("()")) >= 1
            unloved_select.select_by_value("5")
            assert driver.execute_script("return localStorage.getItem('fewercunts.rows-per-page');") == "5"
            driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='Home']").click()
            wait.until(lambda page: page.current_url == "https://ntforum.net/")
            wait.until(lambda page: len(page.find_elements(By.CSS_SELECTOR, ".fewercunts-native-threads .thread-header")) >= 5)
            assert wait.until(lambda page: page.execute_script("""
              return [...document.querySelectorAll('.fewercunts-native-threads a[href*="/thread/15249"]')]
                .some(item => item.getClientRects().length && item.textContent.trim() === 'Welcome to godMode');
            """))
            assert Select(driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select")).first_selected_option.get_attribute("value") == "5"
            assert len([item for item in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-control") if item.is_displayed()]) == 1
            driver.back()
            wait.until(lambda page: page.current_url.endswith("#view=unloved"))
            wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-unloved-header")))
            assert Select(driver.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select")).first_selected_option.get_attribute("value") == "5"
            driver.forward()
            wait.until(lambda page: page.current_url == "https://ntforum.net/")
            wait.until(conditions.visibility_of_element_located((By.CSS_SELECTOR, ".fewercunts-native-threads .thread-header")))
            driver.refresh()
            wait.until(lambda page: Select(page.find_element(By.CSS_SELECTOR, ".fewercunts-primary-nav .fewercunts-rows-select")).first_selected_option.get_attribute("value") == "5")
            assert wait.until(lambda page: page.execute_script("""
              return [...document.querySelectorAll('.fewercunts-native-threads a[href*="/thread/15249"]')]
                .some(item => item.getClientRects().length && item.textContent.trim() === 'Welcome to godMode');
            """))
        finally:
            driver.quit()
    print({"result": "pass", "auto": True, "manualPersistence": True,
           "wholeRows": True, "mobile": True, "accessible": True, "topNavigation": True})


if __name__ == "__main__":
    main()
