### 🎁 New Features

* `ChatPanel` now takes a file dropped anywhere on it, when its composer enables attachments. A
  hint covers the panel while files are dragged over it and states the attachment rules, and a
  drop adds the files to the composer. A `ChatComposer` used on its own still takes a drop on the
  composer only.

### 🐞 Bug Fixes

* `ChatComposerModel.addFilesAsync()` now types a text file by its extension when the browser
  gives it no type, as it can for a markdown file. The codecs then send it as text, and no longer
  leave it out of the request as an unreadable file.
* `ChatThreadList` and `ChatWorkspace` now refuse a file dropped on them, as `ChatMessageList`
  does. The browser no longer opens a file that misses the chat and lands on the thread list.

### ✨ Styles

* Restyled the hint shown over a file drop zone, and added the `xh-chat-drop-hint` class to it,
  with `xh-chat-panel__drop-hint` for the hint of a `ChatPanel`: a scrim, with a large icon over
  a heading and the attachment rules. Added the `--xh-chat-drop-hint-*` variables for its scrim,
  outline, colors and sizes.
* A `ChatPanel` takes `xh-chat-panel--dragging` while files are over it. A composer inside a
  `ChatPanel` no longer shows `xh-chat-composer__drop-hint` or takes `xh-chat-composer--dragging`.
* The hint over a composer now takes its scrim from `--xh-chat-drop-hint-bg`, which fixes a
  scrim too weak to cover the composer in the dark theme.

