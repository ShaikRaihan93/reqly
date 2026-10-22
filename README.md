# Reqly

A lightweight, self-hosted API testing tool built with Spring Boot. Think Postman, but running locally in your browser with zero cloud dependencies.

## Quick Start

**Prerequisites:** Java 17+

```bash
./gradlew bootRun
```

Open **http://localhost:8899** — that's it. Data is stored locally in `~/reqly-data/` using an embedded H2 database.

## Features

### Request Builder
- Supports **GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS** methods
- Query parameter editor (key-value pairs)
- Headers editor
- Body editor with JSON syntax highlighting, raw text, and form-urlencoded support
- Response viewer with status code, headers, timing, and size metrics

### Authentication
- **Bearer Token** — auto-injected as `Authorization: Bearer <token>`
- **Basic Auth** — username/password, Base64-encoded
- **API Key** — custom header name and value

### Environment Variables
- Create multiple environments (e.g., dev, staging, prod)
- Define variables as JSON key-value pairs
- Use `{{variableName}}` syntax anywhere in URLs, headers, body, and auth fields
- Switch environments from the top bar

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

### Bulk & Load Testing
- **Repeat mode** — run a request 1 to 10,000 times with up to 50 concurrent threads
- **CSV-driven** — upload a CSV file, each row becomes a set of variables (`{{columnName}}`)
- **Statistics** — min/max/avg/p95 response times, success/fail counts, requests per second, status code breakdown

### Collections
- Organize requests into hierarchical folders
- Nested sub-collections supported
- Requests auto-named as `METHOD URL` if no name is provided

### cURL Import
Paste a cURL command and Reqly parses it into a request, including method, headers, body, auth, and query parameters.

### Request History
Tracks the last 100 executed requests with method, URL, status code, and timestamp. Click any entry to reload it.

### SSL/TLS
Full HTTPS support. Add `_insecure: true` as a header to skip certificate validation (useful for self-signed certs).

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
| Request timeout  | `60s`   | Per individual HTTP request  |
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
src/main/java/com/reqly/
  controller/       API and page controllers
  entity/           JPA entities (Collection, ApiRequest, RequestHistory, Environment)
  repository/       Spring Data repositories
  service/          Business logic (execution, cURL parsing, CSV reading, test runner)
  dto/              Request/response transfer objects
  config/           Jackson configuration

src/main/resources/
  templates/        index.html (single-page app)
  application.properties              H2 config
  application-mariadb.properties      MariaDB config
```

## License

Private — not licensed for redistribution.