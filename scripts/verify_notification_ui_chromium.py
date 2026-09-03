#!/usr/bin/env python3
"""Verify opt-in notification centre, denied permission, exact targets and persistent controls."""
import json
from pathlib import Path
import shutil
import tempfile
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT=Path(__file__).resolve().parents[1]
def main():
  with tempfile.TemporaryDirectory(prefix="fewercunts-notification-ui-") as temporary:
    extension=Path(temporary)/"extension"; shutil.copytree(ROOT,extension,ignore=shutil.ignore_patterns(".git","dist","__pycache__"))
    manifest_path=extension/"manifest.json"; manifest=json.loads(manifest_path.read_text()); scripts=manifest["content_scripts"][1]["js"]
    scripts.insert(scripts.index("search/ui.js"),"tests/notification-ui-shim.js"); manifest_path.write_text(json.dumps(manifest,indent=2)+"\n")
    options=webdriver.ChromeOptions(); options.binary_location="/usr/bin/chromium"; profile=Path(temporary)/"profile"
    for arg in ("--headless=new","--no-sandbox","--disable-gpu",f"--user-data-dir={profile}",f"--disable-extensions-except={extension}",f"--load-extension={extension}"): options.add_argument(arg)
    driver=webdriver.Chrome(service=Service("/usr/bin/chromedriver"),options=options); wait=WebDriverWait(driver,40,.1)
    def open_centre():
      user=wait.until(lambda page: next((node for node in page.find_elements(By.XPATH,
        "//button[contains(@class,'fewercunts-top-nav') and normalize-space()='User']")
        if node.is_displayed() and node.is_enabled()),None))
      user.click()
      notifications=wait.until(lambda page: next((node for node in page.find_elements(By.XPATH,
        "//button[@role='menuitem' and normalize-space()='Notifications']")
        if node.is_displayed() and node.is_enabled()),None))
      notifications.click()
      return wait.until(lambda page: page.find_element(By.CSS_SELECTOR,".fewercunts-notification-controls"))
    try:
      driver.get("https://ntforum.net/")
      wait.until(lambda page: page.execute_script("return Boolean(globalThis.ko&&ko.dataFor(document.getElementById('theforum'))?.username)"))
      driver.execute_script("ko.dataFor(document.getElementById('theforum')).username('dog hat')")
      controls=open_centre()
      assert "No server push" in controls.text and not driver.find_elements(By.CSS_SELECTOR,".fewercunts-notification-item"), controls.text
      controls.find_element(By.XPATH,".//button[normalize-space()='Enable notifications']").click()
      try: wait.until(lambda page: len(page.find_elements(By.CSS_SELECTOR,".fewercunts-notification-item"))==2)
      except Exception as error:
        diagnostic=driver.execute_script("return {text:document.body.innerText,state:document.documentElement.dataset.notificationUiState||null}")
        raise AssertionError(f"notification centre did not enable: {diagnostic}") from error
      controls=driver.find_element(By.CSS_SELECTOR,".fewercunts-notification-controls")
      assert "browser alerts are unavailable or denied" in controls.text
      state=json.loads(driver.find_element(By.TAG_NAME,"html").get_attribute("data-notification-ui-state")); assert state["permissionRequests"]==1
      links=driver.find_elements(By.CSS_SELECTOR,".fewercunts-notification-item .post-title a")
      assert [link.get_attribute("href") for link in links]==["https://ntforum.net/thread/7/reply/42","https://ntforum.net/thread/7/reply/41"]
      first=driver.find_elements(By.CSS_SELECTOR,".fewercunts-notification-item")[0]
      first.find_element(By.XPATH,".//button[normalize-space()='Mark read']").click()
      wait.until(lambda page: "1 unread reply" in page.find_element(By.CSS_SELECTOR,".fewercunts-search-status").text)
      second=[item for item in driver.find_elements(By.CSS_SELECTOR,".fewercunts-notification-item") if item.is_displayed()][1]
      driver.execute_script("arguments[0].click()",second.find_element(By.XPATH,".//button[normalize-space()='Dismiss']"))
      wait.until(lambda page: len(page.find_elements(By.CSS_SELECTOR,".fewercunts-notification-item"))==1)
      driver.refresh(); open_centre(); wait.until(lambda page: len(page.find_elements(By.CSS_SELECTOR,".fewercunts-notification-item"))==1)
      state=json.loads(driver.find_element(By.TAG_NAME,"html").get_attribute("data-notification-ui-state")); assert len(state["updates"])==2
      driver.set_window_size(390,844); assert driver.execute_script("return document.documentElement.scrollWidth<=document.documentElement.clientWidth")
      assert all(button.get_attribute("type")=="button" for button in driver.find_elements(By.CSS_SELECTOR,".fewercunts-notification-controls button,.fewercunts-notification-item button"))
    finally: driver.quit()
  print({"result":"pass","explicitConsent":True,"permissionDenied":True,"exactTargets":True,"readDismiss":True,"restart":True,"mobile":"390x844","privacy":"local only"})
if __name__=="__main__": main()
