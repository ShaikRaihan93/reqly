package com.reqly.controller

import com.reqly.service.AdminService
import org.springframework.core.io.FileSystemResource
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/** Admin dashboard API. Only admins get here: {@link com.reqly.security.SecurityFilter} guards /api/admin/**. */
@RestController
@RequestMapping("/api/admin")
class AdminController {

    private final AdminService admin

    AdminController(AdminService admin) {
        this.admin = admin
    }

    @ExceptionHandler(IllegalArgumentException)
    ResponseEntity<Map<String, Object>> badRequest(IllegalArgumentException e) {
        ResponseEntity.badRequest().body([error: e.message] as Map<String, Object>)
    }

    @ExceptionHandler(NoSuchElementException)
    ResponseEntity<Map<String, Object>> notFound(NoSuchElementException e) {
        ResponseEntity.status(404).body([error: e.message ?: "Not found"] as Map<String, Object>)
    }

    @ExceptionHandler(org.springframework.dao.DataAccessException)
    ResponseEntity<Map<String, Object>> sqlError(org.springframework.dao.DataAccessException e) {
        ResponseEntity.badRequest().body([error: e.mostSpecificCause?.message ?: e.message] as Map<String, Object>)
    }

    @ExceptionHandler(java.sql.SQLException)
    ResponseEntity<Map<String, Object>> jdbcError(java.sql.SQLException e) {
        ResponseEntity.badRequest().body([error: e.message] as Map<String, Object>)
    }

    @GetMapping("/overview")
    Map<String, Object> overview() { admin.overview() }

    @GetMapping("/tables")
    List<Map<String, Object>> tables() { admin.tables() }

    @GetMapping("/tables/{name}")
    Map<String, Object> rows(@PathVariable String name,
                             @RequestParam(defaultValue = "0") int page,
                             @RequestParam(defaultValue = "50") int size,
                             @RequestParam(required = false) String q,
                             @RequestParam(required = false) String sort,
                             @RequestParam(required = false) String dir) {
        admin.rows(name, page, size, q, sort, dir)
    }

    @PostMapping("/query")
    Map<String, Object> query(@RequestBody Map<String, String> body) { admin.query(body.sql) }

    @GetMapping("/users")
    List<Map<String, Object>> users() { admin.listUsers() }

    @PostMapping("/users/{id}/admin")
    ResponseEntity<Void> setAdmin(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        admin.setAdmin(id, body.admin == true)
        ResponseEntity.ok().build()
    }

    @PostMapping("/users/{id}/signout")
    Map<String, Object> signOut(@PathVariable Long id) { [sessionsEnded: admin.signOutEverywhere(id)] as Map<String, Object> }

    @PostMapping("/users/{id}/reset-password")
    Map<String, Object> resetPassword(@PathVariable Long id) { [temporaryPassword: admin.resetPassword(id)] as Map<String, Object> }

    @DeleteMapping("/users/{id}")
    ResponseEntity<Void> deleteUser(@PathVariable Long id) {
        admin.deleteUser(id)
        ResponseEntity.ok().build()
    }

    @GetMapping("/backups")
    List<Map<String, Object>> backups() { admin.listBackups() }

    @PostMapping("/backups")
    Map<String, Object> backupNow() { admin.backupNow() }

    @GetMapping("/backups/{name:.+}")
    ResponseEntity<FileSystemResource> download(@PathVariable String name) {
        def file = admin.backupFile(name)
        ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"${file.fileName}\"")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(new FileSystemResource(file))
    }
}
