# fewerCunts

An optional browser extension for [ntforum.net](https://ntforum.net/) that adds search, categories, author views, unread state, saved and muted threads, notifications, pagination, and a local block list.

Current version: **4.5.2**

> This independent project is not affiliated with or endorsed by ntforum.net.

## Install

First, choose the browser you actually use:

- **Chrome, Chromium, Brave, Edge, or Vivaldi:** follow [Chromium installation](#chromium-installation).
- **Firefox:** follow [Firefox installation](#firefox-installation). Read the Firefox limitation before starting.
- **Phone or tablet:** there is no supported mobile installation yet.

You do not need Git, a terminal, programming knowledge, or an NTForum password to install the extension.

### Chromium installation

These steps work in desktop Chrome and other Chromium-based browsers.

#### 1. Download

Click **[Download fewerCunts for Chromium](https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v4.5.2/fewerCunts-4.5.2.zip)**.

Your browser normally saves the file in **Downloads**. Do not try to open the ZIP in the browser.

#### 2. Extract the ZIP

The extension must be in a normal folder, not left inside the ZIP.

- **Windows:** open Downloads, right-click `fewerCunts-4.5.2.zip`, select **Extract All**, then **Extract**.
- **macOS:** open Downloads and double-click `fewerCunts-4.5.2.zip`.
- **Linux:** open Downloads, right-click the ZIP, and select **Extract Here** or **Extract To**.

Move the extracted `fewerCunts-4.5.2` folder somewhere permanent, such as Documents. **Do not delete or move this folder after installation**—the browser loads the extension from it.

Open the folder once. You have the correct folder if it contains a file named `manifest.json`. If you see another single folder instead, open that folder and use it in the next step.

#### 3. Open the extensions page

Copy the address for your browser into its address bar:

| Browser | Address |
| --- | --- |
| Chrome, Chromium, Brave, or Vivaldi | `chrome://extensions` |
| Microsoft Edge | `edge://extensions` |

Press Enter.

#### 4. Load the extension

1. Turn on **Developer mode**. It is usually in the top-right corner.
2. Select **Load unpacked**.
3. Select the extracted folder that contains `manifest.json`.
4. Confirm the folder selection.

You should now see a card named **fewerCunts** with version **4.5.2** and no red error message.

#### 5. Check that it works

1. Open or reload [ntforum.net](https://ntforum.net/).
2. Wait for the gold loading bar to finish. The first search database setup can take a minute or two.
3. Look at the forum navigation. You should see **Home**, **User**, **New Topic**, **View**, **Search**, and **About**.
4. Select **Search**, enter a word, and press Enter.

Installation is complete when search results appear.

### Firefox installation

Firefox requires extensions to be signed by Mozilla for permanent installation. The current GitHub package is unsigned, so standard Firefox removes it whenever Firefox closes. Use this route only if you are comfortable reinstalling it after every restart.

#### 1. Download

Click **[Download fewerCunts for Firefox](https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v4.5.2/fewerCunts-firefox-4.5.2.xpi)**.

#### 2. Load it temporarily

1. Enter `about:debugging#/runtime/this-firefox` in the Firefox address bar.
2. Select **Load Temporary Add-on**.
3. Choose `fewerCunts-firefox-4.5.2.xpi` from Downloads.
4. Open or reload [ntforum.net](https://ntforum.net/).
5. Wait for the loading bar, then confirm that **View**, **Search**, and **About** appear in the forum navigation.

If Firefox has been closed since installation, repeat these steps. A permanently installable Firefox package is a version-5 goal.

## If something goes wrong

### “Manifest file is missing” or “Manifest file is unreadable”

You selected the wrong folder or selected the ZIP itself. Extract the ZIP, open the extracted folders until you can see `manifest.json`, then select that folder with **Load unpacked**.

### The extension does not appear on NTForum

1. Return to the extensions page.
2. Confirm that the fewerCunts switch is on.
3. If its card shows **Errors**, remove it and repeat the installation using a freshly downloaded ZIP.
4. Reload NTForum with `Ctrl+R` on Windows/Linux or `Command+R` on macOS.
5. Confirm the address begins with `https://ntforum.net/`.

### The loading bar takes a long time

The first signed search-index download is about 100 MiB. Leave NTForum open and confirm the computer is online. Later starts reuse the verified local copy and should be much quicker.

### Search says it is unavailable or still preparing

Wait two minutes and try again. If it still fails, open **About → Readme** in the extension and confirm the version is 4.5.2, then reload NTForum. Removing and reinstalling the extension is the final recovery step because it can remove extension-owned local settings.

### The browser asks for access

The extension needs access to NTForum and to this project's GitHub release files so it can retrieve the signed public search and category data. It does not need your NTForum password or access to unrelated websites.

If the prompt names unrelated websites, cancel installation and report it through [GitHub Issues](https://github.com/soundoftheglitch/onecunt-fewer/issues).

## Update

An unpacked extension can be given a different browser identity when it is loaded from a different folder. Export your settings first so an update cannot silently leave them behind.

1. In NTForum, select **User → Export settings** and save the file.
2. Download and extract the new Chromium ZIP into a new permanent folder.
3. Open `chrome://extensions` or `edge://extensions` and remove the old fewerCunts card.
4. Select **Load unpacked** and choose the new folder containing `manifest.json`.
5. If your settings are absent, use **User → Import settings** and select the exported file.
6. Reload NTForum and confirm the new version under **About → Version history**.
7. Delete the old extracted folder only after the new version works.

Firefox temporary installations are updated by closing the old temporary entry and loading the new XPI from `about:debugging#/runtime/this-firefox`.

## Uninstall

1. Open `chrome://extensions`, `edge://extensions`, or `about:addons`.
2. Find **fewerCunts** and select **Remove**.
3. Chromium users may then delete the extracted extension folder.

Removing the extension deletes browser-local extension data. It does not alter NTForum posts or the NTForum account.

## Privacy

fewerCunts has no login screen and never reads, stores, relays, or publishes passwords, cookies, private drafts, or browser history. Authentication and posting remain NTForum functions. Search data, category overrides, block settings, read state, saved items, muted items, and notifications remain in browser-local extension storage.

Public search and category data are cryptographically signed and validated before use. A failed update keeps the last verified local generation.

Read the complete [privacy policy](store/PRIVACY.md).

## For developers and maintainers

Installation does not require anything in this section. Architecture, build,
test, security, and release instructions are in
[Developer documentation](docs/DEVELOPING.md). The researched packaging plan is
in the [v5 installation strategy](docs/v5-installation-strategy.md).
