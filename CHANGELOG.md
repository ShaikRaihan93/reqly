# Changelog

Every change to Reqly gets a new version (see `gradle.properties` and `./gradlew bumpVersion`).
Patch versions are fixes and small changes, minor versions add features, major versions break compatibility.

## [1.1.0] - 2026-10-23

- Runner: Parallel now means parallel users
- each user runs the selected requests in order for every iteration, so 2 iterations x 2 parallel sends 4 requests
- with a data file the users share the rows so each row runs once
- the plan before Run shows the total, result rows and the HTML report show which user ran each request

## [1.0.1] - 2026-10-23

- Version is now set in one place (gradle.properties) and shown in the app's About box and sign-in page
- bumpVersion task and CHANGELOG
- Website download link follows the released version
- Download page and release notes explain first launch on macOS 12-14 and macOS 15

## [1.0.0] - 2026-10-23

- First public release: native macOS app (Reqly-1.0.0.dmg)
- Requests, collections, environments with secrets, one-line tests and captures
- Postman-style pre-request and post-response scripts with console
- Collection runner with iterations, CSV/JSON data, parallel requests (across data rows) and reports
- Postman and cURL import/export, code snippets, workspace backup and restore
- Local accounts, encrypted secrets, admin dashboard
