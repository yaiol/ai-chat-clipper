# Changelog

## 1.0.4 — 2026-10-23

- Copy context snapshot: a new button in the popup and on the message-selection page copies a briefing of the chat (or of just the selected messages), ready to paste into another AI so you can continue the discussion there. The prompt asks the receiving AI to write the summary itself, in the chat's language, so the extension does no summarizing and needs no API key
- Google AI Mode: exports no longer come out with your questions and the Sources list but not one answer paragraph, which happened on long live threads. Our own inline buttons were being treated as clutter, and the answer text was removed with them
- Google AI Mode: the inline buttons no longer appear twice on an answer, and they move to Google's action row once the answer has finished streaming, instead of staying at the top
- The popup's Copy as MD and Copy as HTML buttons and the Copied! confirmation are now translated in all 28 languages

## 1.0.3 — 2026-09-14

- Stop duplicating the English translator notes into the other 27 locale files. The `description` field is context about a string, never a translated value — Chrome ignores it at runtime and every tooling script reads it from English — so the copies were write-only. The locale files are roughly half the size; no translated text changed

## 1.0.2 — 2026-09-13

- Greek added — the interface is now available in 28 languages, chosen independently of the browser's language
- The Nextcloud server field's placeholder now reads nextcloud.example.com, so the example no longer implies a Nextcloud must live at a host called "cloud"
- Rewrite the README as a proper GitHub front page — logo, release and download badges, and a nav row to the website, install, features, documentation and build
- Fix the punctuation of the store-description translator note in every locale file

## 1.0.1 — 2026-08-22

- Inline per-message buttons now appear on LobeHub, Merlin, MiniMax and Qwen — these sites had no in-chat buttons at all, so Copy as Markdown, Copy as HTML and the per-message Export file menu were unavailable there
- Grok on grok.com: inline copy and inline export failed on every message with "Empty message" and flashed the button red — turns are now located by their data-testid instead of the action bar's aria-labels, which are localized and made the behaviour depend on the interface language
- Grok single-message exports drop the collapsed thinking pill, the sources row and code-block headers, so a copied answer no longer starts with the language name glued to its first line
- Kimi is recognized on its new kimi.ai domain alongside kimi.com and kimi.moonshot.cn; on kimi.ai the API is authenticated with the stored access token, the only credential that site accepts
- DeepSeek's inline button icons were drawn in pink — DeepSeek sets a purple text colour on the page body that the buttons inherited; they now follow DeepSeek's own icon colour in both light and dark themes
- MiniMax replies rendered as several consecutive blocks are copied whole — only the last block carries the action bar, so a copy anchored there would otherwise take just the tail of the answer
- Correct the MiniMax layout notes: the agent reasoning steps moved from activity-group to turn-process-disclosure. Only the comment was stale — nothing queried that selector

## 1.0.0 — 2026-08-18

- Initial release
