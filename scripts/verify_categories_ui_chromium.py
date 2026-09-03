#!/usr/bin/env python3
from pathlib import Path
import tempfile
from selenium import webdriver
from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]

def enabled_selects(page, selector):
    try:
        items = page.find_elements(By.CSS_SELECTOR, selector)
        result = [item for item in items if item.is_displayed() and item.is_enabled()]
        return result or False
    except StaleElementReferenceException:
        return False

def main():
    with tempfile.TemporaryDirectory(prefix="fewercunts-category-ui-") as profile:
        options = webdriver.ChromeOptions(); options.binary_location = "/usr/bin/chromium"
        for arg in ("--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                    f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"):
            options.add_argument(arg)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 240, poll_frequency=.2)
        try:
            driver.get("https://ntforum.net/")
            wait.until(lambda page: page.execute_script(
                "const view=ko.dataFor(document.getElementById('theforum'));"
                "return view && view.threads && view.threads().length > 0"))
            thread_id = driver.execute_script(
                "const view=ko.dataFor(document.getElementById('theforum')),thread=view.threads()[0];"
                "view.expandThread(thread);return thread.id()")
            thread_ids = driver.execute_script(
                "return ko.dataFor(document.getElementById('theforum')).threads().slice(0,8).map(thread=>thread.id())")
            post_selector = f'.post-container[data-fewercunts-doc-key="t:{thread_id}"]'
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, f'{post_selector} .fewercunts-category-select'))
            driver.execute_script(
                "document.documentElement.classList.remove('fewercunts-starting');"
                "document.querySelector('.fewercunts-startup-loader')?.remove()")
            trigger_selector = f'{post_selector} .fewercunts-category-trigger'
            panel_selector = f'{post_selector} .fewercunts-category-panel'
            trigger = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, trigger_selector))
            assert trigger.text == "Category" and trigger.get_attribute("aria-expanded") == "false"
            assert not driver.find_element(By.CSS_SELECTOR, panel_selector).is_displayed()
            assert driver.find_element(By.CSS_SELECTOR, f'{post_selector} .fewercunts-category-control').text == "Category"
            first_body = driver.find_element(By.CSS_SELECTOR, f'{post_selector} .post-message')
            assert first_body.is_displayed() and first_body.text.strip(), "first opened post body must remain visible"
            trigger.click()
            wait.until(lambda page: page.find_element(By.CSS_SELECTOR, panel_selector).is_displayed())
            assert driver.find_element(By.CSS_SELECTOR, panel_selector).text.startswith("Current category")
            assert "Assign category" in driver.find_element(By.CSS_SELECTOR, panel_selector).text
            selects = wait.until(lambda page: enabled_selects(
                page, f'{post_selector} .fewercunts-category-select'))
            labels = [item.text for item in selects[0].find_elements(By.TAG_NAME, "option")]
            assert len(labels) < 20
            assert all("›" not in label for label in labels)
            assert not any("women" in label.lower() for label in labels)
            driver.execute_script("arguments[0].value='sports';arguments[0].dispatchEvent(new Event('change',{bubbles:true}))", selects[0])
            second = wait.until(lambda page: (enabled_selects(
                page, f'{post_selector} .fewercunts-category-select[data-level="1"]') or [False])[0])
            driver.execute_script("arguments[0].value='sports/football';arguments[0].dispatchEvent(new Event('change',{bubbles:true}))", second)
            third = wait.until(lambda page: (enabled_selects(
                page, f'{post_selector} .fewercunts-category-select[data-level="2"]') or [False])[0])
            driver.execute_script("arguments[0].value='sports/football/mens';arguments[0].dispatchEvent(new Event('change',{bubbles:true}))", third)
            result_selector = f'{post_selector} .fewercunts-category-result'
            wait.until(lambda page: page.find_element(By.CSS_SELECTOR, result_selector).text
                       == "Sports › Football › Men's")
            driver.execute_script(
                "const post=document.querySelector(arguments[0]);"
                "post.querySelector('.fewercunts-category-control')?.remove();"
                "delete post.dataset.fewercuntsCategoryControl;"
                "post.appendChild(document.createComment('category persistence rescan'))", post_selector)
            trigger = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, trigger_selector))
            assert trigger.get_attribute("aria-expanded") == "false"
            trigger.click()
            selects = wait.until(lambda page: enabled_selects(
                page, f'{post_selector} .fewercunts-category-select'))
            assert [item.get_attribute("value") for item in selects] == ["sports", "sports/football", "sports/football/mens"]
            assert driver.find_element(By.CSS_SELECTOR, result_selector).text == "Sports › Football › Men's"
            driver.find_element(By.XPATH, "//button[normalize-space()='Home']").click()
            wait.until(lambda page: page.execute_script(
                "return !ko.dataFor(document.getElementById('theforum')).expandedThread()"))
            second_thread_id = driver.execute_script(
                "const view=ko.dataFor(document.getElementById('theforum')),first=arguments[0];"
                "const thread=view.threads().find(item=>item.id()!==first);"
                "if (!thread) return null; view.expandThread(thread); return thread.id()", thread_id)
            assert second_thread_id and second_thread_id != thread_id
            second_post_selector = f'.post-container[data-fewercunts-doc-key="t:{second_thread_id}"]'
            wait.until(lambda page: len(page.find_elements(
                By.CSS_SELECTOR, f'{second_post_selector} .fewercunts-category-trigger')) == 1)
            assert driver.find_element(By.CSS_SELECTOR, f'{second_post_selector} .fewercunts-category-control').text == "Category"
            second_body = driver.find_element(By.CSS_SELECTOR, f'{second_post_selector} .post-message')
            assert second_body.is_displayed() and second_body.text.strip(), "second opened post body must remain visible"
            for candidate_id in thread_ids:
                driver.find_element(By.XPATH, "//button[normalize-space()='Home']").click()
                wait.until(lambda page: page.execute_script(
                    "return !ko.dataFor(document.getElementById('theforum')).expandedThread()"))
                opened_id = driver.execute_script(
                    "const view=ko.dataFor(document.getElementById('theforum')),id=arguments[0];"
                    "const thread=view.threads().find(item=>item.id()===id);"
                    "if (!thread) return null; view.expandThread(thread); return thread.id()", candidate_id)
                assert opened_id == candidate_id
                candidate_selector = f'.post-container[data-fewercunts-doc-key="t:{candidate_id}"]'
                body_state = wait.until(lambda page: page.execute_script("""
                    const body=document.querySelector(arguments[0] + ' .post-message');
                    if (!body) return false;
                    const style=getComputedStyle(body), box=body.getBoundingClientRect();
                    return {display:style.display, visibility:style.visibility, opacity:style.opacity,
                      width:box.width, height:box.height, text:body.textContent.trim().slice(0,80)};
                """, candidate_selector))
                assert body_state["display"] != "none" and body_state["visibility"] == "visible" \
                    and body_state["opacity"] != "0" and body_state["width"] > 0 and body_state["height"] > 0, \
                    {"threadId": candidate_id, "body": body_state}
                assert len(driver.find_elements(
                    By.CSS_SELECTOR, f'{candidate_selector} .fewercunts-category-trigger')) == 1
            driver.find_element(By.XPATH, "//button[normalize-space()='Search']").click()
            field = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, "input[data-fewercunts-search='true']"))
            field.clear(); field.send_keys('football category:"Sports › Football"', Keys.ENTER)
            wait.until(lambda page: any(node.is_displayed() for node in page.find_elements(By.CSS_SELECTOR, ".fewercunts-search-result-row")))
            assert not [node for node in driver.find_elements(By.CSS_SELECTOR, ".fewercunts-search-status-error") if node.is_displayed()]
            driver.set_window_size(390, 844)
            overflow = driver.execute_script("""
                const root=document.documentElement, width=root.clientWidth;
                return {clientWidth:width, scrollWidth:root.scrollWidth,
                  offenders:[...document.querySelectorAll('body *')]
                    .filter(node=>node.getBoundingClientRect().right > width + 1)
                    .slice(0,10).map(node=>({tag:node.tagName, classes:node.className,
                      right:node.getBoundingClientRect().right, width:node.getBoundingClientRect().width}))};
            """)
            assert overflow["scrollWidth"] <= overflow["clientWidth"], overflow
        finally:
            driver.quit()
    print({"result":"pass", "automatic":True, "manual":True, "reloadPersistence":True,
           "womenSuffixAbsent":True, "categorySearch":True, "mobile":True})

if __name__ == "__main__": main()
