# Reqly UI backup (before the sci-fi theme)

Snapshot of the frontend taken on 2026-10-22, before the sci-fi HUD theme was added.

The same look is still available in the app: use the theme button in the header to
switch to "Dark" or "Light". To fully restore this version instead, copy these files
back over `src/main/resources/` and restart:

    cp backup/ui-before-scifi-2026-10-22/templates/index.html src/main/resources/templates/
    cp backup/ui-before-scifi-2026-10-22/static/css/app.css   src/main/resources/static/css/
    cp backup/ui-before-scifi-2026-10-22/static/js/app.js     src/main/resources/static/js/
