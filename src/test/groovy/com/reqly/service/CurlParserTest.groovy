package com.reqly.service

import org.junit.jupiter.api.Test

import static org.junit.jupiter.api.Assertions.*

class CurlParserTest {

    final parser = new CurlParser()

    @Test
    void parsesMethodHeadersAndBody() {
        def dto = parser.parse("""curl -X PUT 'https://api.example.com/items/7' -H 'Content-Type: application/json' -H 'X-Trace: abc' --data-raw '{"a":1}'""")
        assertEquals("PUT", dto.method)
        assertEquals("https://api.example.com/items/7", dto.url)
        assertEquals("application/json", dto.headers["Content-Type"])
        assertEquals("abc", dto.headers["X-Trace"])
        assertEquals('{"a":1}', dto.body)
    }

    @Test
    void dataWithoutMethodBecomesPost() {
        assertEquals("POST", parser.parse("curl https://x.test -d 'a=1'").method)
    }

    @Test
    void decodesQueryParametersSoTheyAreNotDoubleEncoded() {
        def dto = parser.parse("curl 'https://x.test/search?q=a%20b&tag=x%26y'")
        assertEquals("https://x.test/search", dto.url)
        assertEquals("a b", dto.params["q"])
        assertEquals("x&y", dto.params["tag"])
    }

    @Test
    void bearerHeaderBecomesBearerAuth() {
        def dto = parser.parse("curl https://x.test -H 'Authorization: Bearer tok-123'")
        assertEquals("bearer", dto.authType)
        assertEquals("tok-123", dto.authConfig.token)
    }

    @Test
    void rejectsMethodsThatCouldInjectMarkup() {
        assertEquals("GET", parser.parse("curl -X '<img src=x onerror=alert(1)>' https://x.test").method)
        assertEquals("PURGE", parser.parse("curl -X purge https://x.test").method)
    }
}
