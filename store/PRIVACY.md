# Privacy Policy for fewerCunts

Effective date: 1 September 2026

fewerCunts is a Chromium extension that hides matching content from the rendered interface of https://ntforum.net/ and can optionally install a local search index of public forum content.

## Data collection

The extension does not sell or transmit personal data, browsing history, authentication information, search queries or analytics. It does not render, read, relay or store login passwords; authentication is handled only by NTForum's native posting forms. If the user explicitly enables local search, it downloads a signed base index from the project's public GitHub releases. That base contains public posts and usernames for all authors, including authors the user may hide locally, but no email addresses. The editable blocked-user list, bounded muted-thread list and all filtering remain on the device and are never uploaded. Muted records contain only the exact thread ID, bounded public title and username, canonical NTForum URL and mute time; they exclude bodies and contact fields. Temporary reveal state is held only in the active page and is never persisted. A device-local recent-change delta may retain author email fields returned by ntforum.net solely in that browser profile.

## Local processing

Filtering reads public usernames and reply relationships rendered by ntforum.net. Optional search verifies and processes the GitHub-hosted base entirely inside the browser, then checks only a bounded recent Today/Yesterday overlap through ntforum.net's anonymous API. Ordinary searches cover usernames, titles and post bodies; locally retained email addresses are searched only through an explicit `email:` filter and are never displayed in ordinary results. Search queries are never sent to ntforum.net, GitHub, the developer or any other party.

## Storage

The bounded blocked-user list is stored in extension-owned IndexedDB, seeded with Soulisdead and monkeybutler. An empty custom list is valid and Reset restores those defaults. The extension does not store or apply a theme choice; it inherits NTForum's original palette.

When optional search is enabled, verified immutable base chunks are stored in browser-owned Cache Storage; recent records, tombstones and synchronisation metadata use extension-owned IndexedDB. A separate extension-owned IndexedDB stores at most 5,000 recent post fingerprints and their local read state. Another local database stores at most 2,000 saved thread IDs, titles, usernames, public dates, canonical URLs and save times; it never stores bodies or email addresses and is export-safe. Up to 20 navigation snapshots retain only a local route, result key/index, scroll position and timestamp for at most 30 days, with an explicit clear control. Up to 10 user-entered query and scope combinations are retained for at most 30 days as recent-search suggestions, with individual removal and explicit clearing. A route or recent item can contain a search query entered by the user, but neither adds indexed post bodies or API-acquired contact addresses. Read, saved, navigation and recent-search state never query browser history, synchronise or transmit externally. The active index remains on the device and can be cleared by the user. The extension does not write forum cookies.

The extension does not store drafts; this prevents unpublished writing from crossing the page/extension boundary. Reply notifications are opt-in, baseline existing activity without alerting, and store only bounded public reply metadata and local read/dismiss state. Category overrides store only a post/reply key, thread ID, category ID and update time in extension-owned IndexedDB. Replies inherit the thread category unless locally overridden; these choices are never uploaded or synchronised.

The User menu can export and import a versioned local-settings JSON file. Its fixed allowlist contains blocked usernames, Rows and pagination preferences, search update intervals, and non-content index diagnostics such as state, generation identifier, counts and last-update time. Index diagnostics are informational and are not applied during import. The file never contains theme state, index bytes, public post content, API-provided email fields, credentials, drafts, queries, navigation history, read/saved/muted records, notification content, cookies or browser history. Import rejects malformed, unsupported, oversized and out-of-range files before changing settings, displays a preview for confirmation and attempts to restore the previous settings if a write fails.

## Permissions

The extension runs only on `https://ntforum.net/*`. Its exact host access also permits downloading signed index assets from the project's GitHub release, raw-content and release-asset domains. The `alarms` permission schedules the selected bounded refresh interval. The optional `notifications` permission is requested only when the user enables browser alerts; denial leaves the local notification centre usable. It does not read browsing history, cookies, browser accounts or GitHub account data.

## Remote code and third parties

All executable code is included in the extension package. The extension does not load remote code, use analytics or advertising services, or share data with third parties.

## Changes

If the extension's data practices change, this policy and the Chrome Web Store privacy disclosures will be updated before the changed version is published.
