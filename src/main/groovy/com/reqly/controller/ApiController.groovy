package com.reqly.controller

import com.reqly.dto.*
import com.reqly.entity.*
import com.reqly.entity.Collection
import com.reqly.service.CsvDataReader
import com.reqly.service.PostmanConverter
import com.reqly.service.ReqlyService
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile

@RestController
@RequestMapping("/api")
class ApiController {

    private final ReqlyService service
    private final CsvDataReader csvReader
    private final PostmanConverter postman

    ApiController(ReqlyService service, CsvDataReader csvReader, PostmanConverter postman) {
        this.service = service
        this.csvReader = csvReader
        this.postman = postman
    }

    @ExceptionHandler(IllegalArgumentException)
    ResponseEntity<Map<String, Object>> badRequest(IllegalArgumentException e) {
        ResponseEntity.badRequest().body([error: e.message] as Map<String, Object>)
    }

    @ExceptionHandler(NoSuchElementException)
    ResponseEntity<Map<String, Object>> notFound(NoSuchElementException e) {
        ResponseEntity.status(404).body([error: "Not found"] as Map<String, Object>)
    }

    @GetMapping("/tree")
    Map<String, Object> getTree() {
        service.getTree()
    }

    // --- Collections ---

    @GetMapping("/collections")
    List<Collection> getCollections() {
        service.getRootCollections()
    }

    @PostMapping("/collections")
    Collection createCollection(@RequestBody Map<String, Object> body) {
        service.createCollection(
            body.name as String,
            body.description as String,
            body.parentId != null ? Long.valueOf(body.parentId.toString()) : null
        )
    }

    @DeleteMapping("/collections/{id}")
    ResponseEntity<Void> deleteCollection(@PathVariable Long id) {
        service.deleteCollection(id)
        ResponseEntity.ok().build()
    }

    @PatchMapping("/collections/{id}")
    Collection updateCollection(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        service.updateCollection(id, body)
    }

    @PostMapping("/collections/{id}/duplicate")
    Collection duplicateCollection(@PathVariable Long id) {
        service.duplicateCollection(id)
    }

    @GetMapping("/collections/{id}/export")
    ResponseEntity<Map<String, Object>> exportCollection(@PathVariable Long id) {
        def data = postman.exportCollection(id)
        def filename = (data.info.name as String).replaceAll(/[^\w.-]+/, "_") + ".postman_collection.json"
        ResponseEntity.ok()
            .header("Content-Disposition", "attachment; filename=\"${filename}\"")
            .body(data)
    }

    // --- Requests ---

    @GetMapping("/requests")
    List<RequestDto> getRequests(@RequestParam(required = false) Long collectionId) {
        service.getRequestsByCollection(collectionId)
    }

    @GetMapping("/requests/{id}")
    RequestDto getRequest(@PathVariable Long id) {
        service.getRequestDto(id)
    }

    @PostMapping("/requests")
    ApiRequest saveRequest(@RequestBody RequestDto dto) {
        service.saveRequest(dto)
    }

    @DeleteMapping("/requests/{id}")
    ResponseEntity<Void> deleteRequest(@PathVariable Long id) {
        service.deleteRequest(id)
        ResponseEntity.ok().build()
    }

    @PatchMapping("/requests/{id}")
    RequestDto updateRequest(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        service.getRequestDto(service.updateRequest(id, body).id)
    }

    @PostMapping("/requests/{id}/duplicate")
    RequestDto duplicateRequest(@PathVariable Long id) {
        service.getRequestDto(service.duplicateRequest(id).id)
    }

    // --- Execute ---

    @PostMapping("/execute")
    ExecutionResult execute(@RequestBody RequestDto dto,
                            @RequestParam(required = false) Long environmentId) {
        service.executeRequest(dto, environmentId)
    }

    @PostMapping("/execute/bulk")
    BulkExecutionSummary executeBulk(@RequestBody RequestDto dto,
                                      @RequestParam(defaultValue = "10") int times,
                                      @RequestParam(required = false) Long environmentId) {
        service.executeBulk(dto, times, environmentId)
    }

    @PostMapping("/execute/csv")
    BulkExecutionSummary executeWithCsv(@RequestPart("request") RequestDto dto,
                                         @RequestPart("csv") MultipartFile csvFile,
                                         @RequestParam(required = false) Long environmentId) {
        def rows = csvReader.readFromFile(csvFile)
        service.executeWithCsv(dto, rows, environmentId)
    }

    // --- Import cURL ---

    @PostMapping("/import/curl")
    RequestDto importCurl(@RequestBody Map<String, String> body) {
        service.importCurl(body.curl)
    }

    @GetMapping("/export/all")
    ResponseEntity<Map<String, Object>> exportAll() {
        def stamp = java.time.LocalDate.now().toString()
        ResponseEntity.ok()
            .header("Content-Disposition", "attachment; filename=\"reqly-backup-${stamp}.json\"")
            .body(postman.exportAll())
    }

    @PostMapping(value = "/import/all", consumes = "application/json")
    Map<String, Object> importAll(@RequestBody String json) {
        postman.importAll(json)
    }

    @PostMapping(value = "/import/postman", consumes = "application/json")
    ResponseEntity<Map<String, Object>> importPostman(@RequestBody String json) {
        try {
            ResponseEntity.ok(postman.importCollection(json))
        } catch (Exception e) {
            ResponseEntity.badRequest().body([error: e.message] as Map<String, Object>)
        }
    }

    // --- Environments ---

    @GetMapping("/environments")
    List<Environment> getEnvironments() {
        service.getAllEnvironments()
    }

    @PostMapping("/environments")
    Environment saveEnvironment(@RequestBody Map<String, Object> body) {
        def id = body.id != null ? Long.valueOf(body.id.toString()) : null
        service.saveEnvironment(id, body.name as String, body.variables as String, body.secrets as String)
    }

    @DeleteMapping("/environments/{id}")
    ResponseEntity<Void> deleteEnvironment(@PathVariable Long id) {
        service.deleteEnvironment(id)
        ResponseEntity.ok().build()
    }

    // --- History ---

    @GetMapping("/history")
    List<RequestHistory> getHistory() {
        service.getRecentHistory()
    }

    @DeleteMapping("/history")
    ResponseEntity<Void> clearHistory() {
        service.clearHistory()
        ResponseEntity.ok().build()
    }
}
