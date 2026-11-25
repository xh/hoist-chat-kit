### 🎁 New Features

* Added `--xh-chat-chip-*` CSS variables shared by every framed chip: composer pills, file chips
  and follow-up chips. One override sets the height, gap, font size and colors of them all. File
  and follow-up chips also share the padding.
* Added `--xh-chat-file-chip-height`, `--xh-chat-file-chip-padding`, `--xh-chat-file-chip-gap` and
  `--xh-chat-file-chip-max-width` to size `ChatFileChip`, and `--xh-chat-followup-padding` for
  follow-up chips.

### 🐞 Bug Fixes

* Follow-up chips now use the meta font size and the chip border color, to match the other chips.
* The blocked image placeholder in `ChatMarkdown` now uses `--xh-chat-border-radius`.
* Composer pills and follow-up chips now show their own hover colors,
  `--xh-chat-chip-hover-bg` and `--xh-chat-followup-hover-bg`. Hoist's button hover had overridden
  both. A pressed chip deepens its own color, and an open or active pill keeps its tint, in place
  of Hoist's gray press flash.
