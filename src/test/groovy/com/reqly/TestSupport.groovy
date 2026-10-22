package com.reqly

import com.sun.net.httpserver.HttpServer

import java.nio.file.Files

/** Shared helpers: an isolated data folder for the encryption key, and a tiny local HTTP echo server. */
class TestSupport {

    static {
        // keep the test encryption key away from the real ~/reqly-data
        System.setProperty("reqly.data-dir", Files.createTempDirectory("reqly-test").toString())
    }

    static void init() { /* triggers the static block */ }

    /**
     * Starts a local server that echoes the request as JSON:
     * {method, path, query, headers{lower-case}, body}. /status/{code} replies with that code; /slow sleeps 2s.
     */
    static HttpServer echoServer() {
        def server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            def path = ex.requestURI.path
            if (path.startsWith("/slow")) Thread.sleep(2000)
            def body = ex.requestBody.text
            def headers = ex.requestHeaders.collectEntries { k, v -> [k.toLowerCase(), v.join(",")] }
            def json = groovy.json.JsonOutput.toJson([method: ex.requestMethod, path: path, query: ex.requestURI.rawQuery, headers: headers, body: body])
            int code = path.startsWith("/status/") ? path.substring(8) as int : 200
            def bytes = json.getBytes("UTF-8")
            ex.responseHeaders.add("Content-Type", "application/json")
            ex.responseHeaders.add("X-Echo", "yes")
            ex.sendResponseHeaders(code, bytes.length)
            ex.responseBody.withCloseable { it.write(bytes) }
        }
        server.start()
        server
    }

    static String base(HttpServer s) { "http://127.0.0.1:${s.address.port}".toString() }
}
