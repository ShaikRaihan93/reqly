package com.reqly.api

import com.reqly.TestSupport
import com.reqly.entity.Collection
import com.reqly.repository.CollectionRepository
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult

import static org.junit.jupiter.api.Assertions.*
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@AutoConfigureMockMvc
@Import(LocalhostMockMvc)
@TestMethodOrder(MethodOrderer.OrderAnnotation)
class SecurityAndAccountsIntegrationTest {

    static { TestSupport.init() }

    @Autowired MockMvc mvc
    @Autowired CollectionRepository collections

    static Cookie owner

    private static String json(Map m) { JsonOutput.toJson(m) }
    private static Object parse(MvcResult r) { new JsonSlurper().parseText(r.response.contentAsString) }

    private Cookie signUp(String email, String password = "correct-horse-1") {
        def r = mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content(json([name: "Test ${email}", email: email, password: password, remember: true])))
                .andExpect(status().isOk()).andReturn()
        def cookie = r.response.getCookie("reqly_session")
        assertNotNull(cookie)
        assertTrue(cookie.httpOnly)
        cookie
    }

    @Test @Order(1)
    void requiresSignInForTheAppAndApi() {
        mvc.perform(get("/api/tree")).andExpect(status().isUnauthorized())
        mvc.perform(get("/")).andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("/login"))
        mvc.perform(get("/login")).andExpect(status().isOk())
        mvc.perform(get("/privacy")).andExpect(status().isOk())
    }

    @Test @Order(2)
    void rejectsForeignHostsAndCrossSiteWrites() {
        mvc.perform(get("/login").header("Host", "attacker.example")).andExpect(status().isForbidden())
        mvc.perform(post("/api/auth/signin").header("Origin", "https://attacker.example")
                .contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isForbidden())
        mvc.perform(post("/api/auth/signin").header("Origin", "null")
                .contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isForbidden())
    }

    @Test @Order(3)
    void sendsSecurityHeaders() {
        mvc.perform(get("/login"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().exists("Content-Security-Policy"))
    }

    @Test @Order(4)
    void validatesSignUpInput() {
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content(json([name: "A", email: "a@x.io", password: "short"])))
                .andExpect(status().isBadRequest())
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content(json([name: "A", email: "not-an-email", password: "long-enough-pw"])))
                .andExpect(status().isBadRequest())
    }

    @Test @Order(5)
    void firstAccountClaimsDataCreatedBeforeAccounts() {
        collections.save(new Collection(name: "Legacy collection"))
        owner = signUp("owner@test.io")
        def tree = parse(mvc.perform(get("/api/tree").cookie(owner)).andExpect(status().isOk()).andReturn())
        assertEquals(["Legacy collection"], tree.collections*.name)
    }

    @Test @Order(6)
    void workspacesAreIsolatedBetweenAccounts() {
        def col = parse(mvc.perform(post("/api/collections").cookie(owner).contentType(MediaType.APPLICATION_JSON)
                .content(json([name: "Private"]))).andReturn())
        def req = parse(mvc.perform(post("/api/requests").cookie(owner).contentType(MediaType.APPLICATION_JSON)
                .content(json([name: "secret req", method: "GET", url: "https://x.test", collectionId: col.id]))).andReturn())

        def other = signUp("other@test.io")
        def tree = parse(mvc.perform(get("/api/tree").cookie(other)).andReturn())
        assertTrue(tree.collections.isEmpty())
        mvc.perform(get("/api/requests/${req.id}").cookie(other)).andExpect(status().isNotFound())
        mvc.perform(delete("/api/collections/${col.id}").cookie(other)).andExpect(status().isNotFound())
        mvc.perform(post("/api/requests").cookie(other).contentType(MediaType.APPLICATION_JSON)
                .content(json([id: req.id, name: "hijack", method: "GET", url: "https://evil.test"])))
                .andExpect(status().isNotFound())
        // the owner's request is untouched
        def mine = parse(mvc.perform(get("/api/requests/${req.id}").cookie(owner)).andReturn())
        assertEquals("secret req", mine.name)
    }

    @Test @Order(7)
    void throttlesPasswordGuessing() {
        6.times {
            mvc.perform(post("/api/auth/signin").contentType(MediaType.APPLICATION_JSON)
                    .content(json([email: "owner@test.io", password: "wrong"])))
        }
        mvc.perform(post("/api/auth/signin").contentType(MediaType.APPLICATION_JSON)
                .content(json([email: "owner@test.io", password: "correct-horse-1"])))
                .andExpect(status().isTooManyRequests())
    }

    @Test @Order(8)
    void postmanExportImportRoundTrip() {
        def col = parse(mvc.perform(post("/api/collections").cookie(owner).contentType(MediaType.APPLICATION_JSON)
                .content(json([name: "Round trip"]))).andReturn())
        mvc.perform(post("/api/requests").cookie(owner).contentType(MediaType.APPLICATION_JSON).content(json([
                name: "login", method: "POST", url: "{{base}}/login", collectionId: col.id,
                headers: [Accept: "application/json"], body: '{"u":"a"}', bodyType: "raw",
                authType: "bearer", authConfig: [token: "{{token}}"],
                testScript: "status == 200\njson.token -> token",
                preRequestScript: "console.log('pre')", postResponseScript: "pm.test('ok', () => {})"])))
        def exported = mvc.perform(get("/api/collections/${col.id}/export").cookie(owner)).andReturn().response.contentAsString
        def imported = parse(mvc.perform(post("/api/import/postman").cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content(exported)).andExpect(status().isOk()).andReturn())
        assertEquals(1, imported.requests)
        def tree = parse(mvc.perform(get("/api/tree").cookie(owner)).andReturn())
        def copy = tree.collections.find { it.id == imported.collectionId }.requests[0]
        def dto = parse(mvc.perform(get("/api/requests/${copy.id}").cookie(owner)).andReturn())
        assertEquals("POST", dto.method)
        assertEquals("{{token}}", dto.authConfig.token)
        assertEquals("status == 200\njson.token -> token", dto.testScript)
        assertEquals("console.log('pre')", dto.preRequestScript)
        assertEquals("pm.test('ok', () => {})", dto.postResponseScript)
    }

    @Test @Order(9)
    void changingThePasswordSignsOutOtherSessions() {
        def second = parse(mvc.perform(post("/api/auth/signin").contentType(MediaType.APPLICATION_JSON)
                .content(json([email: "other@test.io", password: "correct-horse-1"]))).andReturn())
        assertNotNull(second.id)
        def a = signInCookie("other@test.io", "correct-horse-1")
        def b = signInCookie("other@test.io", "correct-horse-1")
        mvc.perform(post("/api/auth/password").cookie(a).contentType(MediaType.APPLICATION_JSON)
                .content(json([current: "correct-horse-1", next: "brand-new-pass-2"]))).andExpect(status().isOk())
        mvc.perform(get("/api/tree").cookie(a)).andExpect(status().isOk())
        mvc.perform(get("/api/tree").cookie(b)).andExpect(status().isUnauthorized())
    }

    private Cookie signInCookie(String email, String password) {
        mvc.perform(post("/api/auth/signin").contentType(MediaType.APPLICATION_JSON)
                .content(json([email: email, password: password]))).andExpect(status().isOk()).andReturn()
                .response.getCookie("reqly_session")
    }
}
