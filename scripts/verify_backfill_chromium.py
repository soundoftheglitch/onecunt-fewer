#!/usr/bin/env python3
"""Verify seamless one-for-one blocked-thread backfill in the native model."""

from pathlib import Path
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fewercunts-backfill-") as profile:
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
            wait.until(lambda page: page.execute_script("const vm=ko.dataFor(document.getElementById('theforum')); return vm.pageSize()===25 && !vm.isLoadingThreads();"))
            driver.execute_script("""
              window.__fewercuntsBackfillSeeds = [];
              document.addEventListener('fewercunts:blocked-thread-backfill', event => {
                const request = JSON.parse(event.detail);
                window.__fewercuntsBackfillSeeds.push(request.seed);
                const raw = (id, title) => ({Id:id,Title:title,Message:'zero reply replacement',
                  PostedByUsername:'ordinary user',PostedByEmailAddress:'',
                  CreatedDateTimeUtc:'2024-01-01T00:00:00Z',LastPostDateTimeUtc:'2024-01-01T00:00:00Z',PostCount:1});
                document.dispatchEvent(new CustomEvent('fewercunts:blocked-thread-backfill-result', {
                  detail: JSON.stringify({requestId:request.requestId,threads:window.__fewercuntsEmptyBackfill
                    ? [] : [raw(9001,'Ordinary topic one'),raw(9002,'Ordinary topic two')]})
                }));
              }, true);
              const raw = (id, author) => ({Id:id,Title:`Thread ${id}`,Message:'body',PostedByUsername:author,
                PostedByEmailAddress:'',CreatedDateTimeUtc:'2024-01-01T00:00:00Z',
                LastPostDateTimeUtc:'2024-01-01T00:00:00Z',PostCount:1});
              const vm=ko.dataFor(document.getElementById('theforum'));
              vm.threads([raw(1,'Alice'),raw(2,'Soulisdead'),raw(3,'Bob'),raw(4,' monkeybutler '),raw(5,'Cara')].map(x=>new theforum.Thread(x)));
            """)
            def backfilled(page):
                value = page.execute_script(
                    "return ko.dataFor(document.getElementById('theforum')).threads().map(x=>x.id());")
                return value if value == [1, 9001, 3, 9002, 5] else False

            ids = wait.until(backfilled)
            assert ids == [1, 9001, 3, 9002, 5]
            assert driver.execute_script("""
              const vm=ko.dataFor(document.getElementById('theforum'));
              return vm.threads().every(x => !['soulisdead','monkeybutler'].includes(x.postedByUsername().trim().toLowerCase()))
                && vm.threads().filter(x => [9001,9002].includes(x.id())).every(x => x.postCount() === 1);
            """)
            assert wait.until(lambda page: page.execute_script("""
              const rows=[...document.querySelectorAll('.forum-right-side .thread-header')].filter(x=>x.getClientRects().length);
              return rows.length === 5 && new Set(rows.map(x=>Math.round(x.getBoundingClientRect().height))).size === 1
                && !rows.some(x=>/unloved|replacement/i.test(x.textContent));
            """)), "replacement rows must be visually indistinguishable and preserve list height"
            assert driver.execute_script("return window.__fewercuntsBackfillSeeds.length === 1")
            fallback = driver.execute_script("""
              const side=document.querySelector('#theforum .forum-right-side');
              window.__fewercuntsEmptyBackfill=true;
              const raw=(id,author)=>({Id:id,Title:`Fallback ${id}`,Message:'body',PostedByUsername:author,
                PostedByEmailAddress:'',CreatedDateTimeUtc:'2024-01-01T00:00:00Z',
                LastPostDateTimeUtc:'2024-01-01T00:00:00Z',PostCount:1});
              const vm=ko.dataFor(document.getElementById('theforum'));
              vm.threads([raw(11,'Alice'),raw(12,'Soulisdead'),raw(13,'Bob')].map(x=>new theforum.Thread(x)));
              return {height:side.getBoundingClientRect().height};
            """)
            assert wait.until(lambda page: page.execute_script("""
              const vm=ko.dataFor(document.getElementById('theforum'));
              const side=document.querySelector('#theforum .forum-right-side');
              return vm.threads().length===2 && side.getBoundingClientRect().height >= arguments[0] - .5;
            """, fallback["height"])), "empty/incomplete index must preserve the pre-filter layout height"
        finally:
            driver.quit()
    print({"result": "pass", "positions": [1, 3], "oneForOne": True,
           "nativeRows": True, "zeroReplyOnly": True, "emptyIndexHeight": True})


if __name__ == "__main__":
    main()
