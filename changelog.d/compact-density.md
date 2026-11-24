### 🎁 New Features

* `ChatPanel` now shows at compact density when it is narrow, as `ChatWorkspace` already did. It
  measures its own width and adds `xh-chat--compact`, so a panel docked at the side of an app no
  longer needs the class from the app.
* Added `ChatKit.defaults.compactMaxWidth`, the width at or below which `ChatPanel` and
  `ChatWorkspace` show at compact density. Default 380. Set it to null to never add the class from
  the width.

### 🐞 Bug Fixes

* Compact density no longer hides text with no way to read it:
  * The supporting text of the empty state wraps. It was cut to one line.
  * Every suggestion shows, in one column. Compact density showed only the first three.
  * A tool call row's title has a tooltip with the title and the tool's name, which compact density
    hides.
  * The "Not found" reply lists every document searched in a tooltip. Compact density shows only a
    count, and a wider chat names only the first three.
* A failed tool call row no longer cuts its title when the error beside it is long. The error now
  gives way first.
* The header of a generative UI card shows its title and meta in a tooltip. A narrow card cut them
  with no way to read the rest.
