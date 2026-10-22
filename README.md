# Reqly

A lightweight, self-hosted API testing tool built with Spring Boot. Think Postman, but running locally in your browser with zero cloud dependencies.

## Quick Start

**Prerequisites:** Java 17+

```bash
./gradlew bootRun
```

Open **http://localhost:8899** — that's it. Data is stored locally in `~/reqly-data/` using an embedded H2 database.

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
| Database | H2 (default) or MariaDB                |
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