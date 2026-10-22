package com.reqly.api

import com.reqly.TestSupport
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.web.servlet.MockMvc

import static org.junit.jupiter.api.Assertions.*
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@AutoConfigureMockMvc
@Import(LocalhostMockMvc)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS) // each class gets its own fresh database
@TestMethodOrder(MethodOrderer.OrderAnnotation)
class AdminIntegrationTest {

    static { TestSupport.init() }

    @Autowired MockMvc mvc
    static Cookie admin, member

    private Cookie signUp(String email) {
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content(JsonOutput.toJson([name: email, email: email, password: "correct-horse-1"])))
                .andExpect(status().isOk()).andReturn().response.getCookie("reqly_session")
    }

    private Object query(String sql, int expected = 200) {
        def r = mvc.perform(post("/api/admin/query").cookie(admin).contentType(MediaType.APPLICATION_JSON)
                .content(JsonOutput.toJson([sql: sql]))).andExpect(status().is(expected)).andReturn()
        new JsonSlurper().parseText(r.response.contentAsString)
    }

    @Test @Order(1)
    void firstAccountIsAdminAndOthersAreNot() {
        admin = signUp("admin@test.io")
        member = signUp("member@test.io")
        def me = new JsonSlurper().parseText(mvc.perform(get("/api/auth/me").cookie(admin)).andReturn().response.contentAsString)
        assertTrue(me.admin)
        mvc.perform(get("/api/admin/overview").cookie(admin)).andExpect(status().isOk())
        mvc.perform(get("/api/admin/overview").cookie(member)).andExpect(status().isForbidden())
        mvc.perform(get("/api/admin/tables").cookie(member)).andExpect(status().isForbidden())
        mvc.perform(get("/admin").cookie(member)).andExpect(status().is3xxRedirection())
        mvc.perform(get("/admin")).andExpect(redirectedUrl("/login"))
    }

    @Test @Order(2)
    void sqlConsoleIsReadOnly() {
        assertEquals(2, query("SELECT id, email FROM app_users").rows.size())
        ["DELETE FROM app_users", "UPDATE app_users SET admin = TRUE", "DROP TABLE app_users",
         "SELECT 1; DELETE FROM app_users", "SELECT FILE_WRITE('x', '/tmp/reqly-pwn')", "CALL CSVWRITE('/tmp/x.csv', 'SELECT 1')",
         "SELECT * FROM CSVREAD('/etc/passwd')"].each { sql ->
            def r = query(sql, 400)
            assertNotNull(r.error, sql)
        }
        // the users are still there
        assertEquals(2, query("SELECT COUNT(*) AS n FROM app_users").rows[0].N)
    }

    @Test @Order(3)
    void secretsAreMaskedEverywhere() {
        def viaSql = query("SELECT password_hash FROM app_users").rows[0]
        assertEquals("hash", viaSql.PASSWORD_HASH.masked)
        def table = new JsonSlurper().parseText(mvc.perform(get("/api/admin/tables/AUTH_SESSIONS").cookie(admin)).andReturn().response.contentAsString)
        assertTrue(table.rows.every { it.TOKEN_HASH.masked == "hash" })
        // searching must not reveal hashes either
        def hashPrefix = '$2a$'
        def search = new JsonSlurper().parseText(mvc.perform(get("/api/admin/tables/APP_USERS").param("q", hashPrefix).cookie(admin)).andReturn().response.contentAsString)
        assertEquals(0, search.total)
    }

    @Test @Order(4)
    void unknownTablesAndSortColumnsAreRejected() {
        mvc.perform(get("/api/admin/tables/NOPE").cookie(admin)).andExpect(status().isNotFound())
        mvc.perform(get("/api/admin/tables/APP_USERS").param("sort", "id; DROP TABLE x").cookie(admin)).andExpect(status().isOk())
    }

    @Test @Order(5)
    void adminCanResetAndDeleteOtherUsersButKeepsAnAdmin() {
        def users = new JsonSlurper().parseText(mvc.perform(get("/api/admin/users").cookie(admin)).andReturn().response.contentAsString)
        def memberId = users.find { it.email == "member@test.io" }.id
        def adminId = users.find { it.email == "admin@test.io" }.id
        mvc.perform(post("/api/admin/users/${adminId}/admin").cookie(admin).contentType(MediaType.APPLICATION_JSON).content('{"admin":false}'))
                .andExpect(status().isBadRequest())
        def temp = new JsonSlurper().parseText(mvc.perform(post("/api/admin/users/${memberId}/reset-password").cookie(admin)).andReturn().response.contentAsString).temporaryPassword
        assertEquals(14, temp.length())
        mvc.perform(get("/api/tree").cookie(member)).andExpect(status().isUnauthorized()) // signed out by the reset
        mvc.perform(delete("/api/admin/users/${adminId}").cookie(admin)).andExpect(status().isBadRequest())
        mvc.perform(delete("/api/admin/users/${memberId}").cookie(admin)).andExpect(status().isOk())
        assertEquals(1, query("SELECT COUNT(*) AS n FROM app_users").rows[0].N)
    }
}
