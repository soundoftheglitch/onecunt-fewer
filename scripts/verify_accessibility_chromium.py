#!/usr/bin/env python3
"""Verify Stage 10 keyboard, focus, mobile and motion refinements."""

from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-accessibility-") as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        for argument in ("--headless=new", "--no-sandbox", "--disable-gpu",
                         f"--user-data-dir={profile}", f"--disable-extensions-except={ROOT}",
                         f"--load-extension={ROOT}"):
            options.add_argument(argument)
        driver = webdriver.Chrome(service=Service("/usr/bin/chromedriver"), options=options)
        wait = WebDriverWait(driver, 40, poll_frequency=0.2)
        try:
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
                "width": 320, "height": 720, "deviceScaleFactor": 1, "mobile": True
            })
            driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {
                "features": [{"name": "prefers-reduced-motion", "value": "reduce"}]
            })
            driver.get("https://ntforum.net/")
            wait.until(lambda page: page.find_elements(By.CSS_SELECTOR, ".fewercunts-primary-nav"))

            assert driver.execute_script(
                "return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            assert driver.execute_script("""
              const node = document.querySelector('.fewercunts-top-nav');
              const style = getComputedStyle(node);
              return node.getBoundingClientRect().height >= 40
                && parseFloat(style.animationDuration || '0') <= 0.01
                && parseFloat(style.transitionDuration || '0') <= 0.01;
            """)

            view = driver.find_element(By.XPATH, "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='View']")
            view.send_keys(Keys.ARROW_DOWN)
            assert view.get_attribute("aria-expanded") == "true"
            first = driver.switch_to.active_element
            assert first.get_attribute("role") == "menuitem"
            first.send_keys(Keys.END)
            last = driver.switch_to.active_element
            assert last.get_attribute("role") == "menuitem" and last.id != first.id
            last.send_keys(Keys.HOME)
            assert driver.switch_to.active_element.id == first.id
            first.send_keys(Keys.ESCAPE)
            assert driver.switch_to.active_element.id == view.id
            assert view.get_attribute("aria-expanded") == "false"
            focus = driver.execute_script("""
              const style = getComputedStyle(arguments[0]);
              const rgb = value => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
              const luminance = value => {
                const channels = rgb(value).map(channel => {
                  channel /= 255;
                  return channel <= .04045 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4);
                });
                return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
              };
              const contrast = (first, second) => {
                const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
                return (values[0] + .05) / (values[1] + .05);
              };
              return {style: style.outlineStyle, width: parseFloat(style.outlineWidth),
                dualRing: style.boxShadow.includes('rgb(255, 255, 255)'),
                ringContrast: contrast(style.outlineColor, 'rgb(255, 255, 255)')};
            """, view)
            assert focus["style"] != "none" and focus["width"] >= 2
            assert focus["dualRing"] and focus["ringContrast"] >= 3

            pager = wait.until(lambda page: page.find_element(By.CSS_SELECTOR, ".fewercunts-pagination"))
            assert driver.execute_script("""
              const box = arguments[0].getBoundingClientRect();
              return box.left >= 0 && box.right <= innerWidth + 1;
            """, pager)
            status = pager.find_element(By.CSS_SELECTOR, '[role="status"]')
            assert status.get_attribute("aria-live") == "polite"
            page = pager.find_element(By.CSS_SELECTOR, ".fewercunts-page-input")
            page.send_keys(Keys.CONTROL, "a"); page.send_keys("0", Keys.ENTER)
            assert page.get_attribute("aria-invalid") == "true"
            assert status.get_attribute("textContent").startswith("Enter a page from 1 to ")
        finally:
            driver.quit()
    print({"result": "pass", "viewport": "320x720", "keyboardMenus": True,
           "focusVisible": True, "focusContrast": "at least 3:1", "liveAnnouncements": True, "reducedMotion": True,
           "horizontalOverflow": False})


if __name__ == "__main__":
    main()
