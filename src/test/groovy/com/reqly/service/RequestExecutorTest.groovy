package com.reqly.service

import com.reqly.TestSupport
import com.reqly.dto.RequestDto
import com.sun.net.httpserver.HttpServer
import groovy.json.JsonSlurper
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test

import static org.junit.jupiter.api.Assertions.*

class RequestExecutorTest {

    static HttpServer server
    static String base
    final executor = new RequestExecutor()

    @BeforeAll
    static void start() { server = TestSupport.echoServer(); base = TestSupport.base(server) }

    @AfterAll
    static void stop() { server.stop(0) }

    private Map echo(RequestDto dto, Map<String, String> vars = [:], Map files = [:]) {
        def r = executor.execute(dto, vars, files)
        assertTrue(r.success, r.error)
        new JsonSlurper().parseText(r.responseBody) as Map
    }

    @Test
    void substitutesVariablesEverywhereIncludingQueryParams() {
        def e = echo(new RequestDto(method: "POST", url: "{{base}}/items", params: [q: "{{term}}"],
                headers: ["X-User": "{{user}}"], body: '{"id":"{{id}}"}', bodyType: "raw"),
                [base: base, term: "a b", user: "ada", id: "7"])
        assertEquals("/items", e.path)
        assertEquals("q=a+b", e.query)
        assertEquals("ada", e.headers["x-user"])
        assertEquals('{"id":"7"}', e.body)
    }

    @Test
    void keepsRepeatedQueryKeysInOrder() {
        def e = echo(new RequestDto(method: "GET", url: "${base}/s".toString(),
                paramRows: [[key: "id", value: "1", enabled: true], [key: "id", value: "2", enabled: true], [key: "off", value: "x", enabled: false]]))
        assertEquals("id=1&id=2", e.query)
    }

    @Test
    void configuredAuthReplacesAnExplicitHeaderOfTheSameName() {
        def e = echo(new RequestDto(method: "GET", url: "${base}/a".toString(), headers: [Authorization: "Bearer old"],
                authType: "bearer", authConfig: [token: "new"]))
        assertEquals("Bearer new", e.headers["authorization"])
    }

    @Test
    void sendsMultipartFormDataWithFiles() {
        def rows = '[{"key":"note","value":"hi","type":"text","enabled":true},{"key":"upload","type":"file","enabled":true}]'
        def e = echo(new RequestDto(method: "POST", url: "${base}/upload".toString(), body: rows, bodyType: "form-data"),
                [:], ["1": [name: "a.txt", contentType: "text/plain", bytes: "file-body".bytes]])
        assertTrue(e.headers["content-type"].startsWith("multipart/form-data; boundary="))
        assertTrue(e.body.contains('name="note"') && e.body.contains("hi"))
        assertTrue(e.body.contains('filename="a.txt"') && e.body.contains("file-body"))
    }

    @Test
    void honoursThePerRequestTimeout() {
        def r = executor.execute(new RequestDto(method: "GET", url: "${base}/slow".toString(), settings: [timeoutMs: 1000]), [:])
        assertFalse(r.success)
        assertTrue(r.error.contains("timeout"), r.error)
    }

    @Test
    void explainsUndefinedVariablesInsteadOfCrypticErrors() {
        def r = executor.execute(new RequestDto(method: "GET", url: "{{missing}}/x"), [:])
        assertFalse(r.success)
        assertTrue(r.error.contains("{{missing}}"), r.error)
    }

    @Test
    void reportsUnreachableHostsReadably() {
        def r = executor.execute(new RequestDto(method: "GET", url: "http://127.0.0.1:1/nothing"), [:])
        assertFalse(r.success)
        assertTrue(r.error.startsWith("Could not connect"), r.error)
    }

    @Test
    void masksCredentialsInLogs() {
        def masked = RequestExecutor.maskHeaders([Authorization: ["Bearer x"], "X-Api-Key": ["k"], Accept: ["*/*"]])
        assertEquals("***", masked.Authorization)
        assertEquals("***", masked["X-Api-Key"])
        assertEquals(["*/*"], masked.Accept)
    }
}
