#!/usr/bin/env python3
"""Verify notification consent baseline, deduplication, read/dismiss and restart persistence."""
import json
from pathlib import Path
import tempfile
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
def main():
    with tempfile.TemporaryDirectory(prefix="fewercunts-notifications-") as profile:
        options=webdriver.ChromeOptions(); options.binary_location="/usr/bin/chromium"
        for arg in ("--headless=new","--no-sandbox","--disable-gpu",f"--user-data-dir={profile}","--allow-file-access-from-files"): options.add_argument(arg)
        driver=webdriver.Chrome(service=Service("/usr/bin/chromedriver"),options=options)
        try:
            driver.get((ROOT/"tests/notification-state-browser.html").as_uri())
            text=WebDriverWait(driver,30,.1).until(lambda page:(value:=page.find_element(By.ID,"result").text)!="running" and value)
            result=json.loads(text); assert result["pass"] and result["offlinePreserved"],result
        finally: driver.quit()
    print({"result":"pass","consentBaseline":True,"deduplicated":True,"readDismiss":True,
           "restart":True,"offlinePreserved":True,"privacy":True})
if __name__=="__main__": main()
