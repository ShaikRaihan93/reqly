package com.reqly.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.reqly.entity.ApiRequest
import com.reqly.entity.Collection
import com.reqly.entity.Environment
import com.reqly.repository.ApiRequestRepository
import com.reqly.repository.CollectionRepository
import com.reqly.repository.EnvironmentRepository
import com.reqly.security.CurrentUser
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * Converts between Reqly collections and the Postman Collection v2.0/v2.1 format.
 * Postman JS test scripts can't run here: `pm.response.to.have.status(N)` becomes `status == N`,
 * and Reqly assertions are exported as `// reqly:` comments so they round-trip.
 */
@Service
class PostmanConverter {

    private static final String SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    private static final String REQLY_PREFIX = "// reqly: "

    private final CollectionRepository collectionRepo
    private final ApiRequestRepository requestRepo
    private final EnvironmentRepository envRepo
    private final ObjectMapper objectMapper = new ObjectMapper()

    PostmanConverter(CollectionRepository collectionRepo, ApiRequestRepository requestRepo, EnvironmentRepository envRepo) {
        this.collectionRepo = collectionRepo
        this.requestRepo = requestRepo
        this.envRepo = envRepo
    }

    // --- Import ---

    @Transactional
    Map<String, Object> importCollection(String json) {
        Map data = objectMapper.readValue(json, Map)
        if (!(data.item instanceof List)) throw new IllegalArgumentException("Not a Postman collection: missing 'item' array")

        def root = collectionRepo.save(new Collection(name: data.info?.name ?: "Imported Collection", description: text(data.info?.description), owner: CurrentUser.get()))
        int count = importItems(data.item as List, root, data.auth as Map)

        Environment env = null
        def vars = (data.variable ?: []).findAll { it.key && !it.disabled }
        if (vars) {
            def map = vars.collectEntries { [(it.key): it.value?.toString() ?: ""] }
            env = envRepo.save(new Environment(name: "${root.name} variables", variables: objectMapper.writeValueAsString(map), owner: CurrentUser.get()))
        }
        [collectionId: root.id, name: root.name, requests: count, environmentId: env?.id]
    }

    /** Postman auth is inherited from the nearest folder/collection unless a request sets its own. */
    private int importItems(List items, Collection parent, Map inheritedAuth) {
        int count = 0
        items.eachWithIndex { item, i ->
            def auth = item.auth != null && item.auth.type != "inherit" ? item.auth as Map : inheritedAuth
            if (item.item instanceof List) {
                def folder = collectionRepo.save(new Collection(name: item.name ?: "Folder", parent: parent, sortOrder: i, owner: parent.owner))
                count += importItems(item.item as List, folder, auth)
            } else if (item.request != null) {
                def req = toApiRequest(item, inheritedAuth)
                req.collection = parent
                req.owner = parent.owner
                req.sortOrder = i
                requestRepo.save(req)
                count++
            }
        }
        count
    }

    private ApiRequest toApiRequest(Map item, Map inheritedAuth) {
        def r = item.request instanceof String ? [url: item.request, method: "GET"] : item.request as Map
        def req = new ApiRequest(name: item.name ?: "Request", method: ReqlyService.normalizeMethod((r.method ?: "GET").toString()))

        // URL + query params
        def params = [:], disabledParams = [:]
        if (r.url instanceof Map) {
            def raw = (r.url.raw ?: "").toString()
            if (r.url.query instanceof List && raw.contains("?")) raw = raw.substring(0, raw.indexOf("?"))
            req.url = raw
            (r.url.query ?: []).each { q -> if (q.key) (q.disabled ? disabledParams : params)[q.key] = q.value?.toString() ?: "" }
        } else {
            req.url = (r.url ?: "").toString()
        }

        // Headers
        def headers = [:], disabledHeaders = [:]
        (r.header instanceof List ? r.header : []).each { h -> if (h.key) (h.disabled ? disabledHeaders : headers)[h.key] = h.value?.toString() ?: "" }

        // Body
        def body = r.body as Map
        switch (body?.mode) {
            case "raw":
                req.body = body.raw
                def lang = body.options?.raw?.language
                req.bodyType = lang && lang != "json" ? "text" : "raw"
                def langType = [xml: "application/xml", html: "text/html", javascript: "application/javascript"][lang]
                if (langType && !headers.keySet().any { it.equalsIgnoreCase("Content-Type") }) headers["Content-Type"] = langType
                break
            case "urlencoded":
            case "formdata":
                // form-data has no multipart support here; text fields are sent url-encoded
                req.body = (body[body.mode] ?: []).findAll { !it.disabled && it.type != "file" }
                        .collect { "${enc(it.key)}=${enc(it.value)}" }.join("&")
                req.bodyType = "x-www-form-urlencoded"
                break
            default:
                req.bodyType = "none"
        }

        // Auth
        def auth = (r.auth != null && r.auth.type != "inherit" ? r.auth : inheritedAuth) as Map
        def cfg = { String type -> (auth?.get(type) ?: []).collectEntries { [(it.key): it.value?.toString() ?: ""] } }
        switch (auth?.type) {
            case "bearer":
                req.authType = "bearer"
                req.authConfig = json([token: cfg("bearer").token ?: ""])
                break
            case "basic":
                def c = cfg("basic")
                req.authType = "basic"
                req.authConfig = json([username: c.username ?: "", password: c.password ?: ""])
                break
            case "apikey":
                def c = cfg("apikey")
                if (c.in == "query") {
                    params[c.key ?: "api_key"] = c.value ?: ""
                } else {
                    req.authType = "apikey"
                    req.authConfig = json([key: c.key ?: "X-API-Key", value: c.value ?: "", addTo: "header"])
                }
                break
        }

        req.testScript = importTests(item.event as List)
        // Postman JS scripts run as-is in Reqly's script engine (pm + console)
        req.preRequestScript = scriptOf(item.event as List, "prerequest")
        req.postResponseScript = scriptOf(item.event as List, "test")
        req.headers = json(headers)
        req.params = json(params)
        req.disabledItems = json([headers: disabledHeaders, params: disabledParams])
        req
    }

    private static List<String> execLines(List events, String listen) {
        def exec = events?.find { it.listen == listen }?.script?.exec
        if (!exec) return []
        (exec instanceof List ? exec : [exec]).collectMany { it.toString().readLines() }
    }

    /** Reqly line assertions are carried in Postman scripts as `// reqly:` comments. */
    private static String importTests(List events) {
        def tests = execLines(events, "test").findAll { it.startsWith(REQLY_PREFIX) }.collect { it.substring(REQLY_PREFIX.length()) }
        tests ? tests.join("\n") : null
    }

    private static String scriptOf(List events, String listen) {
        def code = execLines(events, listen).findAll { !it.startsWith(REQLY_PREFIX) }.join("\n").trim()
        code ?: null
    }

    // --- Export ---

    @Transactional(readOnly = true)
    Map<String, Object> exportCollection(Long id) {
        def col = collectionRepo.findById(id).orElseThrow()
        if (col.owner?.id != CurrentUser.id()) throw new NoSuchElementException("Not found")
        [info: [name: col.name, description: col.description, schema: SCHEMA], item: exportItems(col)]
    }

    private List exportItems(Collection col) {
        def folders = collectionRepo.findByParentIdOrderBySortOrder(col.id).collect { [name: it.name, item: exportItems(it)] }
        def requests = requestRepo.findByCollectionIdOrderBySortOrder(col.id).collect { toPostmanItem(it) }
        folders + requests
    }

    private Map toPostmanItem(ApiRequest req) {
        Map<String, String> headers = read(req.headers)
        Map<String, String> params = read(req.params)
        Map disabled = read(req.disabledItems)

        def query = params.collect { k, v -> [key: k, value: v] } + (disabled.params ?: [:]).collect { k, v -> [key: k, value: v, disabled: true] }
        def raw = req.url + (query.findAll { !it.disabled } ? (req.url.contains("?") ? "&" : "?") + query.findAll { !it.disabled }.collect { "${it.key}=${it.value}" }.join("&") : "")
        def request = [
            method: req.method,
            header: headers.collect { k, v -> [key: k, value: v] } + (disabled.headers ?: [:]).collect { k, v -> [key: k, value: v, disabled: true] },
            url   : query ? [raw: raw, query: query] : [raw: req.url]
        ]

        if (req.body && req.bodyType != "none") {
            request.body = req.bodyType == "x-www-form-urlencoded"
                    ? [mode: "urlencoded", urlencoded: req.body.split("&").findAll().collect { kv -> def p = kv.split("=", 2); [key: dec(p[0]), value: p.length > 1 ? dec(p[1]) : ""] }]
                    : [mode: "raw", raw: req.body, options: [raw: [language: req.bodyType == "text" ? "text" : "json"]]]
        }

        Map<String, String> auth = read(req.authConfig)
        switch (req.authType) {
            case "bearer": request.auth = [type: "bearer", bearer: [[key: "token", value: auth.token ?: "", type: "string"]]]; break
            case "basic": request.auth = [type: "basic", basic: [[key: "username", value: auth.username ?: ""], [key: "password", value: auth.password ?: ""]]]; break
            case "apikey": request.auth = [type: "apikey", apikey: [[key: "key", value: auth.key ?: ""], [key: "value", value: auth.value ?: ""], [key: "in", value: "header"]]]; break
        }

        def item = [name: req.name, request: request]
        def events = []
        if (req.preRequestScript?.trim()) {
            events << [listen: "prerequest", script: [type: "text/javascript", exec: req.preRequestScript.readLines()]]
        }
        def testExec = (req.testScript?.readLines()?.findAll { it.trim() }?.collect { REQLY_PREFIX + it.trim() } ?: []) +
                (req.postResponseScript?.trim() ? req.postResponseScript.readLines() : [])
        if (testExec) events << [listen: "test", script: [type: "text/javascript", exec: testExec]]
        if (events) item.event = events
        item
    }

    // --- Full backup: every top-level collection (Postman v2.1) plus all environments ---

    @Transactional(readOnly = true)
    Map<String, Object> exportAll() {
        [
            reqly      : [format: "reqly-backup", version: 1, exportedAt: java.time.OffsetDateTime.now().toString()],
            collections: collectionRepo.findByParentIsNullAndOwnerIdOrderBySortOrder(CurrentUser.id()).collect { exportCollection(it.id) },
            environments: envRepo.findByOwnerIdOrderById(CurrentUser.id()).collect { [name: it.name, variables: it.variables, secrets: it.secrets] },
        ]
    }

    /** Restores a backup by adding its collections and environments next to the existing ones. */
    @Transactional
    Map<String, Object> importAll(String json) {
        Map data = objectMapper.readValue(json, Map)
        if (data.reqly?.format != "reqly-backup") throw new IllegalArgumentException("Not a Reqly backup file")
        int requests = 0
        (data.collections ?: []).each { requests += importCollection(objectMapper.writeValueAsString(it)).requests as int }
        (data.environments ?: []).each { envRepo.save(new Environment(name: it.name, variables: it.variables, secrets: it.secrets, owner: CurrentUser.get())) }
        [collections: (data.collections ?: []).size(), requests: requests, environments: (data.environments ?: []).size()]
    }

    // --- Helpers ---

    private String json(Object o) { objectMapper.writeValueAsString(o) }

    private Map read(String s) {
        if (!s) return [:]
        try { objectMapper.readValue(s, Map) } catch (ignored) { [:] }
    }

    private static String text(Object description) {
        description instanceof Map ? description.content : description?.toString()
    }

    /** Encodes form values but leaves {{variables}} intact so the server can still substitute them. */
    private static String enc(Object s) {
        (s?.toString() ?: "").split(/(?=\{\{)|(?<=\}\})/).collect { it ==~ /\{\{[^}]+\}\}/ ? it : URLEncoder.encode(it, "UTF-8") }.join("")
    }

    private static String dec(String s) {
        try { URLDecoder.decode(s, "UTF-8") } catch (IllegalArgumentException ignored) { s }
    }
}
