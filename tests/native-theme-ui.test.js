"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "starting.css"), "utf8");
const categoryUi = fs.readFileSync(path.join(__dirname, "..", "search", "category-ui.js"), "utf8");
const manifest = require("../manifest.json");

test("inherits NTForum's native palette and contains no theme feature", () => {
  assert.doesNotMatch(css, /data-fewercunts-theme|color-scheme\s*:/);
  assert.equal(manifest.content_scripts.flatMap(group => group.js).includes("theme-state.js"), false);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "search", "ui.js"), "utf8"), /Theme: (?:System|Light|Dark)|Reset theme|FewerCuntsTheme/);
});

test("unread post containers preserve native post-body typography", () => {
  assert.doesNotMatch(css, /(?:^|,)\s*\.fewercunts-unread\s*(?:,|\{)/m);
  assert.match(css, /#theforum :is\(a, button\)\.link-text\.fewercunts-unread,/);
  assert.match(css, /#theforum a\.link-text\.fewercunts-unread:visited/);
  assert.doesNotMatch(css, /(?:^|\})\s*\.fewercunts-unread::before/);
});

test("category controls do not expand the native title strip", () => {
  assert.match(categoryUi, /node\.querySelector\(":scope > \.post-body"\)/);
  assert.match(categoryUi, /if \(!body\?\.querySelector\(":scope > \.post-message"\)\) return/);
  assert.doesNotMatch(categoryUi, /node\.querySelector\("\.post-body"\) \|\| node/);
  assert.match(categoryUi, /author\.insertAdjacentElement\("afterend", label\)/);
  assert.match(categoryUi, /const children = parent => taxonomy\.filter/);
  assert.match(categoryUi, /Topic category/);
  assert.match(categoryUi, /Choose.*subcategory/);
  assert.match(categoryUi, /trigger\.textContent = "Category"; trigger\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(categoryUi, /panel\.hidden = true/);
  assert.match(categoryUi, /currentLabel\.textContent = "Current category"/);
  assert.match(categoryUi, /assignLabel\.textContent = "Assign category"/);
  assert.match(categoryUi, /categoryName === "Uncategorised" \? "Unassigned"/);
  assert.match(categoryUi, /result\.setAttribute\("role", "status"\)/);
  assert.doesNotMatch(categoryUi, /if \(node\.dataset\.fewercuntsCategoryControl\) return/);
  assert.match(categoryUi, /existing\?\.dataset\.fewercuntsDocKey === docKey/);
  assert.match(categoryUi, /existing\?\.remove\(\)/);
  assert.match(categoryUi, /label\.dataset\.fewercuntsDocKey = docKey/);
  assert.doesNotMatch(categoryUi, /node\.querySelector\("\.post-title"\)[^\n]*appendChild\(label\)/);
  assert.match(css, /\.fewercunts-category-control\s*\{[^}]*border-bottom:\s*1px solid var\(--divider-color\)[^}]*color:\s*var\(--body-text-color\)[^}]*font:\s*inherit[^}]*font-weight:\s*400/s);
  assert.match(css, /\.fewercunts-category-select\s*\{[^}]*background-color:\s*var\(--dark-section-bg-color\)[^}]*border:\s*0[^}]*color:\s*var\(--input-text-color\)[^}]*font:\s*inherit/s);
  assert.match(css, /\.fewercunts-category-panel\s*\{[^}]*background:\s*var\(--primary-bg-color\)[^}]*display:\s*flex[^}]*padding:\s*6px/s);
  assert.match(css, /\.fewercunts-category-panel\[hidden\]\s*\{\s*display:\s*none !important/);
  assert.match(css, /\.fewercunts-category-result\s*\{[^}]*color:\s*var\(--body-text-color\)[^}]*flex:\s*1 1 auto[^}]*font:\s*inherit/s);
});

test("keeps compact Save and Mute actions aligned without changing row height", () => {
  assert.match(css, /\.fewercunts-thread-title-cell\s*\{[^}]*padding-right:\s*3\.6em !important[^}]*position:\s*relative/);
  assert.match(css, /\.fewercunts-thread-actions\s*\{[^}]*display:\s*inline-flex[^}]*position:\s*absolute[^}]*right:\s*\.5em/);
  assert.match(css, /content:\s*attr\(data-action-label\)/);
  assert.match(css, /:is\(:hover, :focus-visible\)::after\s*\{\s*display:\s*block/);
  assert.match(css, /\.fewercunts-settings-import\[hidden\]\s*\{\s*display:\s*none !important/);
});

test("scrollbars use forum tokens and preserve forced-colour behavior", () => {
  assert.match(css, /scrollbar-color:\s*var\(--neutral-accent-color\) var\(--primary-bg-color\)/);
  assert.match(css, /::-webkit-scrollbar-thumb[^{]*\{[^}]*background:\s*var\(--neutral-accent-color\)[^}]*border:\s*2px solid var\(--primary-bg-color\)/);
  assert.match(css, /::-webkit-scrollbar-thumb:hover[^}]*background:\s*var\(--secondary-accent-color\)/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*scrollbar-color:\s*auto/);
});
