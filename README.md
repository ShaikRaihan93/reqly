# Reqly

A lightweight, self-hosted API testing tool built with Spring Boot. Think Postman, but running entirely on your machine with zero cloud dependencies.

## Install (macOS)

Download `Reqly-1.0.0.dmg`, open it and drag **Reqly** into Applications. Reqly bundles its own Java runtime.
Reqly opens in its own window with a Dock icon and the usual Mac menus, like Postman or Slack; no browser
needed. It starts its local server itself and stops it when you quit (⌘Q). ⌘T / ⌘W open and close request
tabs, ⌘+ / ⌘− zoom, and **Help → Show Logs** opens `~/reqly-data/logs`.

The first time, create your account on the sign-in screen. Each account has its own workspace; the first
account also takes over anything saved before accounts existed.

## Run from source

**Prerequisites:** Java 17+

```bash
./gradlew bootRun
```

Open **http://localhost:8899**. UI files are served straight from `src/`, so frontend edits show up on reload.
Data is stored in `~/reqly-data/` (embedded H2 database, encryption key, automatic backups, logs).

### Build installers

```bash
./gradlew test            # unit + integration tests
./gradlew packageMacApp   # build/dist/Reqly.app
./gradlew packageMac      # build/dist/Reqly-1.0.0.dmg
./gradlew packageMac -PmacSignIdentity="Developer ID Application: Your Name (TEAMID)"   # signed
```

`Reqly.app` is a small native window (`packaging/macos/shell/main.swift`, WKWebView) around the bundled
server. The build needs Xcode's command-line tools for `swiftc`, and it targets the CPU of the JDK running
Gradle, so build with an Apple-silicon (aarch64) JDK to get a native arm64 app instead of one under Rosetta.

Unsigned builds show an "unidentified developer" warning on other Macs. To distribute, sign with an Apple
Developer ID and notarise the DMG (`xcrun notarytool submit … --wait`, then `xcrun stapler staple`).

## Admin dashboard & database access

Admins (the first account on a machine, plus anyone they promote) get **Admin dashboard** in the account
menu, at `/admin`:

- **Overview**: row counts, database file and size, schema version (Flyway), server info, latest backups
- **Users**: everyone's workspace size and sessions; make/remove admin, sign out everywhere, reset password
  (temporary password shown once), delete an account with its data
- **Tables**: browse every table with search, sorting, paging, CSV export and a row detail panel
- **SQL console**: read-only (one SELECT/WITH/EXPLAIN/SHOW statement, 1,000 rows, 10 s timeout; writes and
  H2 file functions are rejected)
- **Backups**: back up now, download any backup

Password hashes, session tokens and encrypted values are always shown masked.

To open the database in an external tool (DataGrip, DBeaver, the H2 console), quit Reqly first (the file
is locked while it runs) or open a copy from `~/reqly-data/backups`:
JDBC URL `jdbc:h2:file:~/reqly-data/reqly`, user `sa`, empty password. Encrypted columns read as `enc:v1:…`.

## Security & privacy

- The server listens on `127.0.0.1` only and rejects requests addressed to other host names (DNS rebinding)
  and state-changing requests from other websites (Origin check). Security headers and a CSP are set.
- Sign-in required: BCrypt-hashed passwords, hashed session tokens in an HttpOnly, SameSite=Strict cookie,
  sign-in throttling. Forgot your password? Start Reqly with `--reqly.reset-password=you@example.com`
  to get a temporary one printed to the console.
- Environment variables, auth settings and headers are encrypted at rest (AES-256-GCM) with a key in
  `~/reqly-data/reqly.key`; older plaintext values are encrypted at startup, and the database is compacted
  on shutdown so superseded copies don't linger in the file. Credentials are masked in the server log.
- Pre-request and post-response scripts run in a sandboxed frame without access to the app, cookies or API.
- No telemetry, analytics or third-party requests; fonts are bundled.
- The database is backed up to `~/reqly-data/backups` on every start (last 10), before any migration.

See the in-app Privacy Policy (`/privacy`), Terms of Use (`/terms`) and open-source licenses (`/licenses`).
The policy and terms are templates: fill in the bracketed parts and have them reviewed before selling.

## Features

### Workspace
- **Request tabs** that survive a reload, with unsaved-change markers
- **⌘K command palette** to jump to any request, folder, environment or action
- **Sidebar tree** with nested folders, search, drag-and-drop (move and reorder), and rename / duplicate / move / export / delete for requests and folders
- **Themes**: Sci-fi HUD (default, with animations and optional sound effects), Dark and Light
- Side-by-side or stacked request/response layout, collapsible sidebar (⌘B)

### Request Builder
- Supports **GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS** (and custom methods from imports)
- Query params kept in sync with the URL; repeated keys (`?id=1&id=2`) supported; rows can be switched off without deleting them
- Headers editor with bulk-edit mode
- Body: JSON, text, x-www-form-urlencoded, **form-data with file uploads**, **GraphQL** (query + variables)
- **Settings** per request: timeout, ignore SSL errors, follow redirects
- Copy as cURL, or **code snippets** for JavaScript fetch, Python requests and Java HttpClient

### Response Viewer
- Collapsible JSON tree (big numbers shown exactly as sent), Raw, and HTML preview
- **JSONPath filter** (`$.hits.hits[*]._id`, `$..id`) and **⌘F search**
- **History tab** per saved request: view earlier responses and diff any two

### Authentication
- **Bearer Token** — auto-injected as `Authorization: Bearer <token>`
- **Basic Auth** — username/password, Base64-encoded
- **API Key** — custom header name and value

### Environment Variables
- Create multiple environments (e.g., dev, staging, prod)
- Key/value editor; mark values as **secret** to mask them on screen
- Use `{{variableName}}` anywhere in URLs, params, headers, body and auth; type `{{` for **autocomplete**, hover a field to see resolved values
- Undefined variables are highlighted and reported before sending

### Test Assertions
Write simple, line-based test scripts (one assertion per line):

```
status == 200
responseTime < 2000
body contains "success"
header.Content-Type contains "application/json"
json.data.id == "123"
json.data.items.length > 0
```

Supported operators: `==`, `!=`, `<`, `>`, `<=`, `>=`, `contains`, `notContains`, `matches` (regex)

**Chaining requests:** `source -> name` lines save a response value into the active environment, so the next request can use `{{name}}`:

```
json.data.token -> token
header.X-Request-Id -> requestId
```

### Bulk & Load Testing
- **Repeat mode** — run a request 1 to 10,000 times with up to 50 concurrent threads
- **CSV-driven** — upload a CSV file, each row becomes a set of variables (`{{columnName}}`)
- **Statistics** — min/max/avg/p95 response times, success/fail counts, requests per second, status code breakdown

### Collection Runner
- Run a folder with any environment, a number of iterations, a delay, and optional parallelism
- **Data files**: CSV or JSON, one iteration per row, columns become `{{variables}}`
- Export results as an **HTML or JSON report**

### Import, Export & Backups
- Import **Postman v2.0/v2.1** collections (folder auth, variables → environment); export any folder back to Postman format
- **Export everything** (all collections + environments) to one JSON file and restore it later
- Automatic database snapshot to `~/reqly-data/backups` on every start (last 10 kept)

### cURL Import
Paste a cURL command and Reqly parses it into a request, including method, headers, body, auth, and query parameters.

### Request History
Tracks the last 100 executed requests grouped by day. Click any entry to reopen it together with its response.

### SSL/TLS
Full HTTPS support. Turn on *Ignore SSL certificate errors* in a request's Settings tab for self-signed certs (the older `_insecure: true` header still works). Credentials are masked in the server log.

## Tech Stack

| Layer    | Technology                              |
|----------|-----------------------------------------|
| Backend  | Spring Boot 3.2.5, Java 17             |
| Frontend | Vanilla JS, HTML5, CSS (dark theme)     |
| Database | H2 (default, Flyway migrations) or MariaDB |
| HTTP     | Java HttpClient + Apache HttpClient 5   |
| CSV      | OpenCSV 5.9                             |

## Configuration

### Default (H2 — zero config)

Runs out of the box. Data persists to `~/reqly-data/`. H2 console available at `/h2`.

### MariaDB

```bash
./gradlew bootRun --args='--spring.profiles.active=mariadb'
```

Expects MariaDB on `localhost:3306`. Default credentials: `root`/`root`. The `reqly` database is auto-created.

Edit `src/main/resources/application-mariadb.properties` to change connection details.

### Key Properties

| Property        | Default | Description                  |
|-----------------|---------|------------------------------|
| `server.port`   | `8899`  | HTTP server port             |
| Max file upload  | `50MB`  | For CSV bulk execution       |
| Request timeout  | `60s`   | Default; override per request in Settings |
| History limit    | `100`   | Most recent executions kept  |
| Max concurrency  | `50`    | Parallel threads in bulk mode|

## REST API

| Method | Endpoint                        | Description                        |
|--------|---------------------------------|------------------------------------|
| GET    | `/api/collections`              | List root collections (tree)       |
| POST   | `/api/collections`              | Create collection                  |
| DELETE | `/api/collections/{id}`         | Delete collection (cascading)      |
| GET    | `/api/requests?collectionId=`   | List requests by collection        |
| GET    | `/api/requests/{id}`            | Get single request                 |
| POST   | `/api/requests`                 | Create/update request              |
| DELETE | `/api/requests/{id}`            | Delete request                     |
| POST   | `/api/execute?environmentId=`   | Execute single request             |
| POST   | `/api/execute/bulk?times=&environmentId=` | Bulk execute N times     |
| POST   | `/api/execute/csv?environmentId=` | CSV-driven bulk execute          |
| POST   | `/api/import/curl`              | Parse cURL command                 |
| GET    | `/api/environments`             | List environments                  |
| POST   | `/api/environments`             | Create/update environment          |
| DELETE | `/api/environments/{id}`        | Delete environment                 |
| GET    | `/api/history`                  | Get recent execution history       |

## Project Structure

```
src/main/groovy/com/reqly/
  controller/       API and page controllers
  entity/           JPA entities (Collection, ApiRequest, RequestHistory, Environment)
  repository/       Spring Data repositories
  service/          Business logic (execution, cURL parsing, CSV reading, test runner)
  dto/              Request/response transfer objects
  config/           Jackson configuration, startup database backup

src/main/resources/
  templates/        index.html (single-page app markup)
  static/js/        app.js
  static/css/       app.css (dark/light), scifi.css (sci-fi theme)
  application.properties              H2 config
  application-mariadb.properties      MariaDB config
```

## License

Private — not licensed for redistribution.