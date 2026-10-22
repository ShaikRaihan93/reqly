package com.reqly.service

import com.reqly.dto.ExecutionResult
import org.junit.jupiter.api.Test

import static org.junit.jupiter.api.Assertions.*

class TestRunnerTest {

    final runner = new TestRunner()
    final result = new ExecutionResult(success: true, statusCode: 201, responseTimeMs: 120,
            responseHeaders: ["Content-Type": "application/json; charset=utf-8", "X-Request-Id": "rid-9"],
            responseBody: '{"data":{"id":"42","items":[1,2,3],"user":{"name":"Ada"}},"token":"t-1"}')

    @Test
    void evaluatesAssertions() {
        def results = runner.runTests("""
            status == 201
            responseTime < 500
            body contains "Ada"
            header.Content-Type contains "json"
            json.data.id == "42"
            json.data.items.length > 2
            status == 200
        """, result)
        assertEquals(7, results.size())
        assertTrue(results.take(6).every { it.passed }, results.collect { "${it.testName}: ${it.passed} ${it.message}" }.join('\n'))
        assertFalse(results[6].passed)
    }

    @Test
    void explainsUnsupportedComparisons() {
        def results = runner.runTests("status 201\nresponseTime == 120", result)
        assertTrue(results.every { !it.passed && it.message.startsWith("Unsupported comparison") }, results*.message.join('\n'))
    }

    @Test
    void captureLinesAreNotTreatedAsAssertions() {
        def results = runner.runTests("status == 201\njson.token -> token", result)
        assertEquals(1, results.size())
    }

    @Test
    void capturesValuesFromTheResponse() {
        def caps = runner.captureValues("""
            json.token -> token
            json.data.user -> user
            header.x-request-id -> rid
            status -> code
            json.missing.path -> nope
        """, result)
        def byName = caps.collectEntries { [it.name, it] }
        assertEquals("t-1", byName.token.value)
        assertEquals('{"name":"Ada"}', byName.user.value)
        assertEquals("rid-9", byName.rid.value)
        assertEquals("201", byName.code.value)
        assertFalse(byName.nope.ok)
        assertTrue(byName.nope.message instanceof String)
    }
}
