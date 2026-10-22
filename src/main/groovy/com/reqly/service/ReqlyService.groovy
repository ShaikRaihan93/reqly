package com.reqly.service

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.reqly.dto.*
import com.reqly.entity.*
import com.reqly.entity.Collection
import com.reqly.repository.*
import com.reqly.security.CurrentUser
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class ReqlyService {

    private final CollectionRepository collectionRepo
    private final ApiRequestRepository requestRepo
    private final EnvironmentRepository envRepo
    private final RequestHistoryRepository historyRepo
    private final RequestExecutor executor
    private final TestRunner testRunner
    private final CurlParser curlParser
    private final CsvDataReader csvReader
    private final ObjectMapper objectMapper = new ObjectMapper()

    ReqlyService(CollectionRepository collectionRepo, ApiRequestRepository requestRepo,
                 EnvironmentRepository envRepo, RequestHistoryRepository historyRepo,
                 RequestExecutor executor, TestRunner testRunner,
                 CurlParser curlParser, CsvDataReader csvReader) {
        this.collectionRepo = collectionRepo
        this.requestRepo = requestRepo
        this.envRepo = envRepo
        this.historyRepo = historyRepo
        this.executor = executor
        this.testRunner = testRunner
        this.curlParser = curlParser
        this.csvReader = csvReader
    }

    // --- Ownership: everything is scoped to the signed-in account; other accounts' ids look like "not found" ---

    private static <T> T owned(T entity) {
        if (entity?.owner?.id != CurrentUser.id()) throw new NoSuchElementException("Not found")
        entity
    }

    Collection ownedCollection(Long id) { owned(collectionRepo.findById(id).orElseThrow()) }
    ApiRequest ownedRequest(Long id) { owned(requestRepo.findById(id).orElseThrow()) }
    Environment ownedEnvironment(Long id) { owned(envRepo.findById(id).orElseThrow()) }

    // --- Collections ---

    Collection createCollection(String name, String description, Long parentId) {
        def col = new Collection(name: name, description: description, owner: CurrentUser.get())
        if (parentId != null) col.parent = ownedCollection(parentId)
        collectionRepo.save(col)
    }

    List<Collection> getRootCollections() {
        collectionRepo.findByParentIsNullAndOwnerIdOrderBySortOrder(CurrentUser.id())
    }

    void deleteCollection(Long id) {
        collectionRepo.delete(ownedCollection(id))
    }

    @Transactional
    Collection updateCollection(Long id, Map<String, Object> body) {
        def col = ownedCollection(id)
        if (body.name) col.name = body.name as String
        if (body.containsKey("parentId")) {
            def parentId = body.parentId != null ? Long.valueOf(body.parentId.toString()) : null
            def parent = parentId != null ? ownedCollection(parentId) : null
            for (def p = parent; p != null; p = p.parent) {
                if (p.id == col.id) throw new IllegalArgumentException("Cannot move a folder into itself")
            }
            col.parent = parent
        }
        collectionRepo.save(col)
    }

    @Transactional
    Collection duplicateCollection(Long id) {
        def src = ownedCollection(id)
        copyCollection(src, src.parent, "${src.name} Copy")
    }

    private Collection copyCollection(Collection src, Collection parent, String name) {
        def copy = collectionRepo.save(new Collection(name: name, description: src.description, parent: parent, sortOrder: src.sortOrder, owner: src.owner))
        requestRepo.findByCollectionIdOrderBySortOrder(src.id).each { requestRepo.save(copyRequest(it, copy, it.name)) }
        collectionRepo.findByParentIdOrderBySortOrder(src.id).each { copyCollection(it, copy, it.name) }
        copy
    }

    /** Whole sidebar in one call: nested folders with lightweight request summaries. */
    @Transactional(readOnly = true)
    Map<String, Object> getTree() {
        def byOrder = { a, b -> (a.sortOrder ?: 0) <=> (b.sortOrder ?: 0) ?: a.id <=> b.id }
        def nodes = collectionRepo.findByOwnerId(CurrentUser.id()).sort(byOrder).collectEntries { c ->
            [c.id, [id: c.id, name: c.name, parentId: c.parent?.id, folders: [], requests: []]]
        }
        def unsorted = []
        requestRepo.findByOwnerId(CurrentUser.id()).sort(byOrder).each { r ->
            def summary = [id: r.id, name: r.name, method: r.method, url: r.url]
            def colId = r.collection?.id
            colId != null && nodes[colId] ? nodes[colId].requests << summary : unsorted << summary
        }
        def roots = []
        nodes.values().each { n -> n.parentId != null && nodes[n.parentId] ? nodes[n.parentId].folders << n : roots << n }
        [collections: roots, requests: unsorted]
    }

    // --- Requests ---

    ApiRequest saveRequest(RequestDto dto) {
        // An id that no longer exists (deleted elsewhere) saves as a new request
        def existing = dto.id != null ? requestRepo.findById(dto.id).orElse(null) : null
        def req = existing != null ? owned(existing) : new ApiRequest(owner: CurrentUser.get())

        req.name = dto.name ?: "${dto.method} ${dto.url}"
        req.method = normalizeMethod(dto.method)
        req.url = dto.url
        req.body = dto.body
        req.bodyType = dto.bodyType
        req.authType = dto.authType
        req.testScript = dto.testScript
        req.preRequestScript = dto.preRequestScript
        req.postResponseScript = dto.postResponseScript

        try {
            if (dto.headers != null) req.headers = objectMapper.writeValueAsString(dto.headers)
            if (dto.params != null) req.params = objectMapper.writeValueAsString(dto.params)
            if (dto.authConfig != null) req.authConfig = objectMapper.writeValueAsString(dto.authConfig)
            req.disabledItems = objectMapper.writeValueAsString([headers: dto.disabledHeaders ?: [:], params: dto.disabledParams ?: [:], paramRows: dto.paramRows])
            req.settings = dto.settings ? objectMapper.writeValueAsString(dto.settings) : null
        } catch (ignored) {}

        if (dto.collectionId != null) {
            req.collection = ownedCollection(dto.collectionId)
        }
        if (dto.environmentId != null) {
            req.environment = envRepo.findById(dto.environmentId).filter { it.owner?.id == CurrentUser.id() }.orElse(null)
        }

        requestRepo.save(req)
    }

    /** Methods end up in HTML class names and labels, so only plain tokens like GET or PURGE are accepted. */
    static String normalizeMethod(String method) {
        def m = method?.trim()?.toUpperCase()
        m ==~ /[A-Z]{1,20}/ ? m : "GET"
    }

    RequestDto getRequestDto(Long id) {
        toDto(ownedRequest(id))
    }

    List<RequestDto> getRequestsByCollection(Long collectionId) {
        def requests = collectionId != null
                ? requestRepo.findByCollectionIdOrderBySortOrder(ownedCollection(collectionId).id)
                : requestRepo.findByCollectionIsNullAndOwnerIdOrderBySortOrder(CurrentUser.id())
        requests.collect { toDto(it) }
    }

    void deleteRequest(Long id) {
        requestRepo.delete(ownedRequest(id))
    }

    @Transactional
    ApiRequest updateRequest(Long id, Map<String, Object> body) {
        def req = ownedRequest(id)
        if (body.name) req.name = body.name as String
        if (body.containsKey("collectionId")) {
            req.collection = body.collectionId != null
                    ? ownedCollection(Long.valueOf(body.collectionId.toString()))
                    : null
        }
        requestRepo.save(req)
    }

    /** Sets the order of requests inside a folder (or the unsorted list when collectionId is null). */
    @Transactional
    void reorderRequests(List<Long> ids) {
        ids.eachWithIndex { Long id, int i ->
            def r = ownedRequest(id)
            r.sortOrder = i
            requestRepo.save(r)
        }
    }

    @Transactional
    void reorderCollections(List<Long> ids) {
        ids.eachWithIndex { Long id, int i ->
            def c = ownedCollection(id)
            c.sortOrder = i
            collectionRepo.save(c)
        }
    }

    @Transactional
    ApiRequest duplicateRequest(Long id) {
        def src = ownedRequest(id)
        requestRepo.save(copyRequest(src, src.collection, "${src.name} Copy"))
    }

    private static ApiRequest copyRequest(ApiRequest src, Collection target, String name) {
        new ApiRequest(
            name: name, method: src.method, url: src.url, headers: src.headers, params: src.params,
            body: src.body, bodyType: src.bodyType, authType: src.authType, authConfig: src.authConfig,
            testScript: src.testScript, preRequestScript: src.preRequestScript, postResponseScript: src.postResponseScript, disabledItems: src.disabledItems, settings: src.settings,
            collection: target, environment: src.environment, sortOrder: src.sortOrder, owner: src.owner
        )
    }

    // --- Execution ---

    ExecutionResult executeRequest(RequestDto dto, Long environmentId, Map<String, Map> files = [:]) {
        def vars = getEnvironmentVariables(environmentId)
        def result = executor.execute(dto, vars, files)

        if (dto.testScript?.trim()) {
            result.testResults = testRunner.runTests(dto.testScript, result)
            result.captures = testRunner.captureValues(dto.testScript, result)
            saveCaptures(result, environmentId)
        }

        saveHistory(dto, result)
        result
    }

    /** Writes successful captures into the active environment so later requests can use {{name}}. */
    private void saveCaptures(ExecutionResult result, Long environmentId) {
        def ok = result.captures?.findAll { it.ok }
        if (!ok || environmentId == null) return
        envRepo.findById(environmentId).filter { it.owner?.id == CurrentUser.id() }.ifPresent { env ->
            Map<String, String> vars = [:]
            try { if (env.variables) vars = objectMapper.readValue(env.variables, new TypeReference<LinkedHashMap<String, String>>() {}) } catch (ignored) {}
            ok.each { vars[it.name as String] = it.value as String }
            env.variables = objectMapper.writeValueAsString(vars)
            envRepo.save(env)
            result.captureEnvironment = env.name
        }
    }

    BulkExecutionSummary executeBulk(RequestDto dto, int times, Long environmentId) {
        def vars = getEnvironmentVariables(environmentId)
        long start = System.currentTimeMillis()
        def results = executor.executeBulk(dto, times, vars)
        long totalDuration = System.currentTimeMillis() - start

        if (dto.testScript?.trim()) {
            results.each { r -> r.testResults = testRunner.runTests(dto.testScript, r) }
        }

        buildSummary(results, totalDuration)
    }

    BulkExecutionSummary executeWithCsv(RequestDto dto, List<Map<String, String>> csvRows, Long environmentId) {
        def vars = getEnvironmentVariables(environmentId)
        long start = System.currentTimeMillis()
        def results = executor.executeWithCsv(dto, csvRows, vars)
        long totalDuration = System.currentTimeMillis() - start

        if (dto.testScript?.trim()) {
            results.each { r -> r.testResults = testRunner.runTests(dto.testScript, r) }
        }

        buildSummary(results, totalDuration)
    }

    // --- Import cURL ---

    RequestDto importCurl(String curl) {
        curlParser.parse(curl)
    }

    // --- Environments ---

    Environment saveEnvironment(Long id, String name, String variables, String secrets = null) {
        def existing = id != null ? envRepo.findById(id).orElse(null) : null
        def env = existing != null ? owned(existing) : new Environment(owner: CurrentUser.get())
        env.name = name
        env.variables = variables
        if (secrets != null) env.secrets = secrets
        envRepo.save(env)
    }

    List<Environment> getAllEnvironments() {
        envRepo.findByOwnerIdOrderById(CurrentUser.id())
    }

    void deleteEnvironment(Long id) {
        envRepo.delete(ownedEnvironment(id))
    }

    // --- History ---

    List<RequestHistory> getRecentHistory() {
        historyRepo.findTop100ByOwnerIdOrderByExecutedAtDesc(CurrentUser.id())
    }

    List<RequestHistory> getRequestHistory(Long requestId) {
        historyRepo.findByApiRequestIdOrderByExecutedAtDesc(ownedRequest(requestId).id).take(20)
    }

    @Transactional
    void clearHistory() {
        historyRepo.deleteByOwner(CurrentUser.id())
    }

    // --- Helpers ---

    private Map<String, String> getEnvironmentVariables(Long envId) {
        if (envId == null) return [:]
        envRepo.findById(envId).filter { it.owner?.id == CurrentUser.id() }.map { env ->
            try {
                objectMapper.readValue(env.variables, new TypeReference<Map<String, String>>() {})
            } catch (Exception e) {
                [:] as Map<String, String>
            }
        }.orElse([:])
    }

    private void saveHistory(RequestDto dto, ExecutionResult result) {
        try {
            // Keep the query in the stored URL so reopening a history entry restores its params
            def pairs = dto.paramRows != null
                    ? dto.paramRows.findAll { it.enabled != false && it.key }.collect { [it.key, it.value] }
                    : dto.params?.collect { k, v -> [k, v] }
            def query = pairs?.collect { kv -> kv[1] ? "${kv[0]}=${kv[1]}" : kv[0] }?.join("&")
            def history = new RequestHistory(
                method: dto.method,
                url: query ? dto.url + (dto.url.contains("?") ? "&" : "?") + query : dto.url,
                requestHeaders: dto.headers != null ? objectMapper.writeValueAsString(dto.headers) : null,
                requestBody: dto.body,
                statusCode: result.statusCode,
                responseBody: result.responseBody,
                responseHeaders: result.responseHeaders != null ? objectMapper.writeValueAsString(result.responseHeaders) : null,
                responseTimeMs: result.responseTimeMs,
                responseSizeBytes: result.responseSizeBytes,
                testResults: result.testResults != null ? objectMapper.writeValueAsString(result.testResults) : null,
                owner: CurrentUser.get()
            )

            if (dto.id != null) {
                requestRepo.findById(dto.id).filter { it.owner?.id == CurrentUser.id() }.ifPresent { history.apiRequest = it }
            }
            historyRepo.save(history)
        } catch (ignored) {}
    }

    private RequestDto toDto(ApiRequest req) {
        def dto = new RequestDto(
            id: req.id,
            name: req.name,
            method: req.method,
            url: req.url,
            body: req.body,
            bodyType: req.bodyType,
            authType: req.authType,
            testScript: req.testScript,
            preRequestScript: req.preRequestScript,
            postResponseScript: req.postResponseScript,
            collectionId: req.collection?.id,
            environmentId: req.environment?.id
        )
        try {
            if (req.headers) dto.headers = objectMapper.readValue(req.headers, new TypeReference<Map<String, String>>() {})
            if (req.params) dto.params = objectMapper.readValue(req.params, new TypeReference<Map<String, String>>() {})
            if (req.authConfig) dto.authConfig = objectMapper.readValue(req.authConfig, new TypeReference<Map<String, String>>() {})
            if (req.settings) dto.settings = objectMapper.readValue(req.settings, new TypeReference<Map<String, Object>>() {})
            if (req.disabledItems) {
                def disabled = objectMapper.readValue(req.disabledItems, new TypeReference<Map<String, Object>>() {})
                dto.disabledHeaders = disabled.headers as Map<String, String>
                dto.disabledParams = disabled.params as Map<String, String>
                dto.paramRows = disabled.paramRows as List<Map<String, Object>>
            }
        } catch (ignored) {}
        dto
    }

    private BulkExecutionSummary buildSummary(List<ExecutionResult> results, long totalDuration) {
        long[] times = results.collect { it.responseTimeMs }.sort() as long[]
        int success = results.count { it.statusCode >= 200 && it.statusCode < 400 }

        def statusCounts = results.groupBy { it.statusCode }.collectEntries { k, v -> [k, v.size()] }

        def breakdown = statusCounts.collect { code, count ->
            new BulkExecutionSummary.StatusCodeBreakdown(
                statusCode: code,
                count: count,
                percentage: count * 100.0 / results.size()
            )
        }

        new BulkExecutionSummary(
            totalRequests: results.size(),
            successCount: success,
            failCount: results.size() - success,
            avgResponseTimeMs: times.length > 0 ? (times.sum() / times.length) as long : 0,
            minResponseTimeMs: times.length > 0 ? times[0] : 0,
            maxResponseTimeMs: times.length > 0 ? times[-1] : 0,
            p95ResponseTimeMs: times.length > 0 ? times[(int)(times.length * 0.95)] : 0,
            requestsPerSecond: totalDuration > 0 ? results.size() * 1000.0 / totalDuration : 0,
            totalDurationMs: totalDuration,
            statusBreakdown: breakdown,
            results: results
        )
    }
}
