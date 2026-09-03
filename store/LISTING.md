# Chrome Web Store listing

- Name: `fewerCunts`
- Summary: Filters blocked NTForum users and adds optional, private full-forum search.
- Category: Social & Communication
- Language: English (United Kingdom)
- Visibility: Unlisted

## Detailed description

fewerCunts keeps NTForum focused by removing threads and comments authored by configured forum accounts and by letting users mute complete threads locally. When a hidden comment has replies, its complete reply subtree is removed as well. Optional device-local search, unread, saved and muted views, temporary reveal and reply notifications add navigation and continuity without analytics or account access.

Filtering and queries happen locally in the browser. Search downloads a signed, privacy-filtered index of public forum content from the project's GitHub releases and checks only a bounded recent NTForum overlap at the chosen interval. The extension has no analytics, advertising, remote code or account access.

## Single purpose

Improve reading and finding public NTForum content locally while removing configured accounts and their reply subtrees.

## Permission justification

NTForum access filters the page and, when search is enabled, reads bounded anonymous API updates. Exact GitHub release hosts provide the signed public base index. `alarms` schedules the selected refresh interval. The optional `notifications` permission is requested only when browser reply alerts are enabled.

## Privacy practices

- Website content: public posts and usernames are processed and stored locally for filtering, search and reading-state features.
- Personally identifiable information: public usernames and recent API email fields may be stored locally; email is searchable only through explicit `email:` queries and is not included in the public base.
- Web history: not collected.
- Authentication, financial, health and location data: not collected. Saved items, unread state and notification state remain on the device; drafts are not stored by the extension.
- Data sale, transfer, analytics, advertising, and remote code: none.
- Certification: data is not sold or transferred outside the approved use cases; data is not used for purposes unrelated to the extension's single purpose; data is not used for creditworthiness or lending.
- Privacy-policy URL: the public repository's `store/PRIVACY.md` policy applies to version 4.5.1.

## Assets

- Store icon: `icons/icon128.png` (128×128 PNG)
- Screenshot: `store/screenshot-1280x800.png` (1280×800 PNG)
- Small promotional tile: `store/small-promo-440x280.png` (440×280 PNG)
