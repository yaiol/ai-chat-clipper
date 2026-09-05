<p align="center">
  <img src="docs/assets/logo.png" alt="AI Chat Clipper" width="110" height="110">
</p>

<h1 align="center">AI Chat Clipper</h1>

<div align="center">
  <strong>Your AI chats, as real documents.</strong><br>
  Reads <b>32</b> chat sites; exports to <b>7</b> file formats, <b>5</b> cloud services, or the clipboard.
</div>

<br>

<!-- readme:nav -->

<div align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/yaiol/ai-chat-clipper?color=5a4fff&label=release&style=flat-square" alt="Release"></a>
  <a href="../../releases"><img src="https://img.shields.io/github/downloads/yaiol/ai-chat-clipper/total?color=5a4fff&label=downloads&style=flat-square" alt="Downloads"></a>
</div>

<h3 align="center">
  <a href="https://apps.yaiol.com/en/p/ai-chat-clipper/">Website</a>
  <span>&nbsp;·&nbsp;</span>
  <a href="#install">Install</a>
  <span>&nbsp;·&nbsp;</span>
  <a href="#what-it-is">Features</a>
  <span>&nbsp;·&nbsp;</span>
  <a href="#documentation">Documentation</a>
  <span>&nbsp;·&nbsp;</span>
  <a href="#build-from-source">Development</a>
</h3>

<div align="center">
  <sub><a href="https://apps.yaiol.com/en/p/ai-chat-clipper/help/"><b>Help in 28 languages</b></a></sub>
</div>

<!-- /readme:nav -->

---

<p align="center">
  <img src="docs/assets/hero.png" alt="AI Chat Clipper exporting a conversation from its toolbar popup" width="900">
</p>

---

## Install

Not yet on the Web Store. To run it unpacked:

1. Build `dist/chrome/` (see [Build from source](#build-from-source)).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → pick `dist/chrome/`.

For Edge use `dist/edge/`, for Firefox `dist/firefox/`.

---

## What it is

AI Chat Clipper is a Chrome / Edge / Firefox (MV3) browser extension that turns an AI conversation into a real document. Instead of copy-pasting a chat out of the browser - losing its formatting, code blocks, and math - you click once and get a clean Markdown / Word / PDF file, a copy in a cloud service, or the conversation on your clipboard ready to paste. It reads the conversation straight from the page (or the site's own API), so there is no separate API key to manage.

---

## Features

- **Works on 32 AI sites** - ChatGPT, Claude, Google (Search, Search AI Mode, Gemini, Gemini Notebook, AI Studio), Copilot, DeepSeek, Grok (including on X), Perplexity, Mistral, Kimi, Qwen, MiniMax, Pi, Poe, Meta AI, Yuanbao, GitHub Copilot, HuggingChat, Groq, DuckDuckGo AI Chat, LobeHub, Merlin, Reve, Z.ai, Dola, M365 Copilot, ChatGLM, Arena.
- **Seven file formats** - Markdown, HTML, plain text, Word (.docx), OpenDocument (.odt), PDF, and a full-page PNG image.
- **Five cloud destinations** - send a chat straight to Google Docs, Word Online, OneNote, Notion, or your own Nextcloud.
- **Images** - browse every picture in a conversation in a grid, pick the ones you want, and download them in one go.
- **Copy to the clipboard** - grab the conversation as Markdown, or as rich HTML that pastes cleanly into Gmail, Docs, and Word.
- **Whole chat or one message** - export the full thread from the popup, a single answer from each reply's inline button, or a hand-picked selection.
- **28 languages** - the popup and settings pages are localized, chosen independently of your browser.

---

## Documentation

| | |
|---|---|
| **User manual** | [Read it online](https://apps.yaiol.com/en/p/ai-chat-clipper/help/) |
| **What's new** | [Release notes](https://apps.yaiol.com/en/p/ai-chat-clipper/help/releases/) |
| **Product page** | [apps.yaiol.com](https://apps.yaiol.com/en/p/ai-chat-clipper/) |

---

## Build from source

No bundler, no transpilation - the build just copies `src/` plus the per-browser manifest into `dist/`.

```bash
node app-build.mjs            # builds every manifest in manifests/
node app-build.mjs chrome     # builds only chrome
```

Edit anything under `src/`, re-run `app-build.mjs`, then reload the extension card at `chrome://extensions`.

### Cloud exports — bring your own OAuth

The cloud export targets (Google Drive, Microsoft Word Online / OneNote, Notion) sign in with
OAuth, and OAuth credentials are bound to a specific extension. **This repo ships with no OAuth
credentials of ours** — `manifests/chrome.json` intentionally has **no `oauth2.client_id`** — so a
fork can't accidentally authenticate against our projects, and instead wires its own.

The other exports (Markdown, HTML, PDF, DOCX, ODT, TXT, JSON, clipboard) need none of this and work
out of the box.

To enable **Google Drive** export in your own build:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project, **enable the
   Google Drive API**, and create an **OAuth client** of type **Chrome Extension** whose *Item ID* is
   your extension's id (shown on `chrome://extensions`). Add yourself as a test user on the consent
   screen (or publish it).
2. Put your client id into the manifest's `oauth2` block — either edit `manifests/chrome.json`
   directly, or (the mechanism this project uses) drop it in a gitignored overlay
   `manifests/chrome.dev.json` (merged into the unpacked build) / `manifests/chrome.pub.json`
   (merged into the store `.zip`):

   ```json
   { "oauth2": { "client_id": "YOUR_ID.apps.googleusercontent.com",
                 "scopes": ["https://www.googleapis.com/auth/drive.file"] } }
   ```

Microsoft and Notion work the same way (their own app registration + `https://<your-ext-id>.chromiumapp.org/…`
redirect URIs); see the code in `src/lib/microsoft-auth.js` / `src/lib/notion-auth.js`.

---

## Architecture

The extension is a thin orchestration shell around a per-site adapter layer and a set of pure format exporters.

| Piece | Role |
|---|---|
| `background.js` | Service worker - orchestrates downloads, opens print tabs, reads page globals from the MAIN world, drives the cloud uploads |
| `content.js` | Content script - inline per-message buttons, hover menu, full-conversation and selection export, `MutationObserver` re-injection |
| `popup.html` / `popup.js` | Toolbar popup - format buttons + drag-reorderable site grid |
| `options.html` / `options.js` | Settings page - General (language, fonts, math) and AI Sites (visibility + drag-sort) |
| `sites/<id>.js` | One adapter per site - `id`, `matches(host)`, `extract()`, optional `findMountPoints()` |
| `sites/registry.js` | Picks the adapter matching the current host |
| `exporters/<format>.js` | Pure converters from the canonical conversation shape to each output |
| `lib/*.js` | Shared helpers - storage, i18n, ZIP, HTML↔Markdown, fonts, the cloud auth/upload flows |

<details>
<summary><b>Data flow, and the API-vs-DOM rule</b></summary>

Every adapter normalizes a conversation to one canonical shape:

```
adapter.extract() → { title, url, site, messages: [{ role, markdown }] }
                  → exporters/<format>  → file download, print tab, cloud upload, or clipboard
```

An adapter prefers the site's own API where one exists (ChatGPT, Claude, Gemini, Copilot, DeepSeek, Grok, Perplexity, Kimi, Yuanbao, GitHub Copilot) and **always falls back to scraping the rendered DOM** if the API call fails. The rest are DOM-only. Z.ai sits between the two: it has an API, but its stored document lags the conversation, so the adapter only accepts an API result that is demonstrably complete and otherwise reads the DOM.

</details>

<details>
<summary><b>Supported sites</b></summary>

32 sites: Arena, ChatGLM, ChatGPT, Claude, Copilot, DeepSeek, Dola, DuckDuckGo AI Chat, GitHub Copilot, Google AI Studio, Google Gemini, Google Gemini Notebook, Google Search, Google Search AI Mode, Grok, Grok on X, Groq, HuggingChat, Kimi, LobeHub, M365 Copilot, Merlin, Meta AI, MiniMax, Mistral, Perplexity, Pi, Poe, Qwen, Reve, Yuanbao, Z.ai.

</details>

<details>
<summary><b>Export pipeline</b></summary>

| Output | Implemented by | Notes |
|---|---|---|
| Markdown | `exporters/markdown.js` | direct serializer |
| HTML | `exporters/html.js` | optional Google Fonts + KaTeX math from CDN |
| Plain text | `exporters/text.js` | strips formatting |
| Word (.docx) | `exporters/docx.js` | OOXML `<altChunk>`, built with `lib/zip.js` |
| OpenDocument (.odt) | `exporters/odt.js` | ODF package, built with `lib/zip.js` |
| PDF | `content.js` print path | reuses the HTML output, auto-`window.print()` → "Save as PDF" |
| PNG image | `exporters/image.js` | full-page rendering |
| Google Docs / Word Online / OneNote | `exporters/msword.js` + `lib/microsoft-auth.js` | cloud upload |
| Notion | `exporters/notion.js` + `lib/notion-auth.js` | cloud upload (Markdown → Notion blocks) |
| Nextcloud | `exporters/nextcloud.js` + `lib/nextcloud-auth.js` | cloud upload |
| Clipboard | `content.js` | Markdown or rich HTML |

</details>

---

## License

Released under the [MIT License](LICENSE).

<div align="center">
  <sub>AI Chat Clipper is part of <a href="https://apps.yaiol.com">yaiol Applications</a>.</sub>
</div>
