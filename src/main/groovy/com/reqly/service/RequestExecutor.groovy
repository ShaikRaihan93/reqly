package com.reqly.service

import com.reqly.dto.ExecutionResult
import com.reqly.dto.RequestDto
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

import javax.net.ssl.*
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.security.cert.X509Certificate
import java.time.Duration
import java.util.concurrent.*

@Service
class RequestExecutor {

    private static final Logger log = LoggerFactory.getLogger(RequestExecutor)

    /** One client per (ignore SSL, follow redirects) combination, created on first use */
    private final Map<String, HttpClient> clients = new ConcurrentHashMap<>()

    private HttpClient client(boolean insecure, boolean followRedirects) {
        clients.computeIfAbsent("${insecure}/${followRedirects}".toString()) { buildClient(insecure, followRedirects) }
    }

    /**
     * @param files uploaded file parts for form-data bodies, keyed by the row index in the form-data rows
     *              (each value: [name: String, contentType: String, bytes: byte[]])
     */
    ExecutionResult execute(RequestDto request, Map<String, String> variables, Map<String, Map> files = [:]) {
        def result = new ExecutionResult()
        long startTime = System.currentTimeMillis()
        String url = request.url

        try {
            url = substituteVariables(buildUrl(request, variables), variables)
            if (url =~ /\{\{[^}]+\}\}/) throw new IllegalArgumentException("unresolved variable")
            def builder = HttpRequest.newBuilder().uri(URI.create(encodeUnsafeChars(url)))

            // Headers
            def headers = request.headers != null ? new HashMap<>(request.headers) : [:]
            def settings = request.settings ?: [:]
            boolean insecure = "true" == headers.remove("_insecure") || settings.insecure == true
            boolean followRedirects = settings.followRedirects != false
            long timeoutMs = settings.timeoutMs ? (settings.timeoutMs as long) : 60_000L

            // form-data needs its own Content-Type with the multipart boundary
            String boundary = null
            if (request.bodyType == "form-data") {
                boundary = "----ReqlyBoundary" + UUID.randomUUID().toString().replace("-", "")
                headers.removeAll { it.key.equalsIgnoreCase("Content-Type") }
                headers["Content-Type"] = "multipart/form-data; boundary=${boundary}".toString()
            }

            // Auto-set Content-Type from bodyType if not explicitly provided and there's a body
            if (request.body && !headers.any { it.key.equalsIgnoreCase("Content-Type") }) {
                switch (request.bodyType) {
                    case "json": headers["Content-Type"] = "application/json"; break
                    case "xml": headers["Content-Type"] = "application/xml"; break
                    case "form": headers["Content-Type"] = "application/x-www-form-urlencoded"; break
                    case "raw": headers["Content-Type"] = "text/plain"; break
                }
            }

            // Auth — apply first, then let explicit headers override
            applyAuth(builder, request, variables)

            // If auth is configured, drop the explicit header it would duplicate (Authorization, or the API key's own name)
            if (request.authType && request.authConfig) {
                def authHeader = request.authType == "apikey" ? (request.authConfig.key ?: "X-API-Key") : "Authorization"
                headers.removeAll { it.key.equalsIgnoreCase(authHeader) }
            }

            headers.each { key, value ->
                builder.header(key, substituteVariables(value, variables))
            }

            // Body
            String body
            HttpRequest.BodyPublisher bodyPublisher
            if (boundary != null) {
                byte[] bytes = multipartBody(request.body, files ?: [:], variables, boundary)
                body = "(multipart form-data, ${bytes.length} bytes)".toString()
                bodyPublisher = HttpRequest.BodyPublishers.ofByteArray(bytes)
            } else if (request.bodyType == "x-www-form-urlencoded" && variables) {
                // The body arrives already form-encoded, so a variable's value must be encoded too or "&"/"=" in it splits fields
                def encoded = variables.collectEntries { k, v -> [k, URLEncoder.encode(v ?: "", StandardCharsets.UTF_8)] } as Map<String, String>
                body = request.body != null ? substituteVariables(request.body, encoded) : null
                bodyPublisher = body != null ? HttpRequest.BodyPublishers.ofString(body) : HttpRequest.BodyPublishers.noBody()
            } else {
                body = request.body != null ? substituteVariables(request.body, variables) : null
                bodyPublisher = body != null ? HttpRequest.BodyPublishers.ofString(body) : HttpRequest.BodyPublishers.noBody()
            }

            builder.method(request.method.toUpperCase(), bodyPublisher)
            builder.timeout(Duration.ofMillis(Math.max(1000L, timeoutMs)))

            def httpRequest = builder.build()
            log.info("=== Outgoing Request ===")
            log.info("Method: {} URL: {}", httpRequest.method(), httpRequest.uri())
            log.info("Headers: {}", maskHeaders(httpRequest.headers().map()))
            log.info("Body: {} chars", body?.length() ?: 0)
            log.debug("Body: {}", body)
            log.info("BodyType: {} | Insecure: {}", request.bodyType, insecure)
            log.info("========================")

            def client = client(insecure, followRedirects)
            def response = client.send(httpRequest, HttpResponse.BodyHandlers.ofString())

            long elapsed = System.currentTimeMillis() - startTime
            log.info("=== Response: {} in {}ms ===", response.statusCode(), elapsed)

            result.statusCode = response.statusCode()
            result.responseBody = response.body()
            result.responseTimeMs = elapsed
            result.responseSizeBytes = response.body()?.bytes?.length ?: 0

            def responseHeaders = [:] as LinkedHashMap<String, String>
            response.headers().map().each { k, v -> responseHeaders[k] = v.join(", ") }
            result.responseHeaders = responseHeaders
            result.success = true

        } catch (Exception e) {
            result.success = false
            result.error = describeError(e, url)
            result.responseTimeMs = System.currentTimeMillis() - startTime
        }
        result
    }

    /** Java's HTTP client often throws with a null message; turn the common cases into something actionable. */
    private static String describeError(Exception e, String url) {
        def unresolved = (url =~ /\{\{([^}]+)\}\}/).collect { it[1] }.unique()
        if (unresolved) {
            return "The URL uses undefined variable${unresolved.size() > 1 ? 's' : ''} ${unresolved.collect { "{{${it}}}" }.join(', ')}. Select an environment that defines ${unresolved.size() > 1 ? 'them' : 'it'}."
        }
        def causes = []
        for (Throwable t = e; t != null && causes.size() < 5; t = t.cause) causes << t
        def detail = causes.collect { it.message }.find { it } ?: ""
        def has = { Class c -> causes.any { c.isInstance(it) } }
        if (has(UnknownHostException)) return "Host not found: ${detail}. Check the URL and your network/VPN."
        if (has(java.net.http.HttpConnectTimeoutException)) return "Timed out while connecting. The server may be down or blocked by a firewall/VPN."
        if (has(java.net.http.HttpTimeoutException)) return "No response before the timeout. Raise it in the request's Settings tab if the server is just slow."
        if (has(ConnectException)) return "Could not connect to ${hostOf(url)}. Check the host and port, that the server is running, and your network/VPN."
        if (has(SSLException)) return "SSL/TLS error: ${detail}. For self-signed certificates, add the header _insecure: true."
        if (e instanceof IllegalArgumentException) return "Invalid URL: ${detail}"
        "${e.class.simpleName}${detail ? ': ' + detail : ''}"
    }

    private static final SENSITIVE = ~/(?i)authorization|cookie|token|secret|password|api[-_]?key|x-auth|session/

    /** Never write credentials to the log. */
    static Map<String, Object> maskHeaders(Map<String, List<String>> headers) {
        headers.collectEntries { k, v -> [k, (k =~ SENSITIVE).find() ? "***" : v] }
    }

    private static String hostOf(String url) {
        try { def u = URI.create(url); u.port > 0 ? "${u.host}:${u.port}" : u.host } catch (ignored) { url }
    }

    List<ExecutionResult> executeBulk(RequestDto request, int times, Map<String, String> variables) {
        def executor = Executors.newFixedThreadPool(Math.min(times, 50))
        def futures = (0..<times).collect { i ->
            def iterVars = new HashMap<>(variables)
            iterVars["__iteration"] = String.valueOf(i)
            executor.submit({ -> execute(request, iterVars) } as Callable<ExecutionResult>)
        }

        def results = futures.collect { f ->
            try {
                f.get(120, TimeUnit.SECONDS)
            } catch (Exception e) {
                def err = new ExecutionResult(success: false, error: e.message)
                err
            }
        }
        executor.shutdown()
        results
    }

    List<ExecutionResult> executeWithCsv(RequestDto request, List<Map<String, String>> csvRows, Map<String, String> envVars) {
        csvRows.withIndex().collect { row, i ->
            def combined = new HashMap<>(envVars)
            combined.putAll(row)
            combined["__iteration"] = String.valueOf(i)
            def result = execute(request, combined)
            result.csvRow = i
            result
        }
    }

    private static final String URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!\$&'()*+,;="

    /**
     * Percent-encodes characters that cannot appear in a URL (spaces, quotes, non-ASCII...), as browsers and Postman do,
     * so a variable value like "Ada L" works. Valid URL syntax and existing %XX escapes are left alone.
     */
    static String encodeUnsafeChars(String url) {
        def out = new StringBuilder()
        for (int i = 0; i < url.length(); ) {
            int cp = url.codePointAt(i)
            int len = Character.charCount(cp)
            def ch = url.substring(i, i + len)
            boolean escape = ch == "%" && i + 3 <= url.length() && url.substring(i + 1, i + 3) ==~ /[0-9A-Fa-f]{2}/
            if (escape || URL_SAFE.contains(ch)) out << ch
            else ch.getBytes(StandardCharsets.UTF_8).each { b -> out << String.format("%%%02X", b & 0xff) }
            i += len
        }
        out.toString()
    }

    // Variables are substituted before encoding; afterwards "{{x}}" would already be "%7B%7Bx%7D%7D"
    private String buildUrl(RequestDto request, Map<String, String> variables) {
        def url = request.url
        // paramRows keeps order and repeated keys (?id=1&id=2); params is the older map form
        def pairs = request.paramRows != null
                ? request.paramRows.findAll { it.enabled != false && it.key }.collect { [it.key as String, (it.value ?: "") as String] }
                : (request.params ?: [:]).collect { k, v -> [k, v] }
        if (pairs) {
            def enc = { String s -> URLEncoder.encode(substituteVariables(s ?: "", variables), StandardCharsets.UTF_8) }
            def queryString = pairs.collect { kv -> "${enc(kv[0])}=${enc(kv[1])}" }.join("&")
            url += (url.contains("?") ? "&" : "?") + queryString
        }
        url
    }

    private void applyAuth(HttpRequest.Builder builder, RequestDto request, Map<String, String> variables) {
        if (!request.authType) return
        def config = request.authConfig
        if (!config) return

        switch (request.authType) {
            case "bearer":
                builder.header("Authorization", "Bearer ${substituteVariables(config.getOrDefault('token', ''), variables)}")
                break
            case "basic":
                def user = substituteVariables(config.getOrDefault("username", ""), variables)
                def pass = substituteVariables(config.getOrDefault("password", ""), variables)
                def encoded = Base64.encoder.encodeToString("${user}:${pass}".bytes)
                builder.header("Authorization", "Basic ${encoded}")
                break
            case "apikey":
                def key = config.getOrDefault("key", "X-API-Key")
                def value = substituteVariables(config.getOrDefault("value", ""), variables)
                def addTo = config.getOrDefault("addTo", "header")
                if (addTo == "header") {
                    builder.header(key, value)
                }
                break
        }
    }

    private String substituteVariables(String input, Map<String, String> variables) {
        if (!input || !variables) return input
        def result = input
        variables.each { key, value ->
            result = result.replace("{{${key}}}", value)
        }
        result
    }

    private static HttpClient buildClient(boolean insecure, boolean followRedirects) {
        def b = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .followRedirects(followRedirects ? HttpClient.Redirect.NORMAL : HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(30))
        if (insecure) {
            def trustAll = [
                new X509TrustManager() {
                    X509Certificate[] getAcceptedIssuers() { new X509Certificate[0] }
                    void checkClientTrusted(X509Certificate[] certs, String type) {}
                    void checkServerTrusted(X509Certificate[] certs, String type) {}
                }
            ] as TrustManager[]
            def sc = SSLContext.getInstance("TLS")
            sc.init(null, trustAll, new java.security.SecureRandom())
            b.sslContext(sc)
        }
        b.build()
    }

    /** form-data rows are stored as a JSON array of {key, value, type: text|file, enabled, fileName}. */
    private byte[] multipartBody(String rowsJson, Map<String, Map> files, Map<String, String> variables, String boundary) {
        List<Map> rows = []
        try { if (rowsJson) rows = new groovy.json.JsonSlurper().parseText(rowsJson) as List<Map> } catch (ignored) {}
        def out = new ByteArrayOutputStream()
        def write = { String s -> out.write(s.getBytes(StandardCharsets.UTF_8)) }
        def quote = { String s -> (s ?: "").replace('"', '%22').replace("\r", "").replace("\n", "") }
        rows.eachWithIndex { Map row, int i ->
            if (row.enabled == false || !row.key) return
            def name = substituteVariables(row.key as String, variables)
            if (row.type == "file") {
                def f = files[String.valueOf(i)]
                if (f == null) return
                write("--${boundary}\r\nContent-Disposition: form-data; name=\"${quote(name)}\"; filename=\"${quote(f.name as String)}\"\r\n")
                write("Content-Type: ${f.contentType ?: 'application/octet-stream'}\r\n\r\n")
                out.write(f.bytes as byte[])
                write("\r\n")
            } else {
                write("--${boundary}\r\nContent-Disposition: form-data; name=\"${quote(name)}\"\r\n\r\n")
                write(substituteVariables((row.value ?: "") as String, variables))
                write("\r\n")
            }
        }
        write("--${boundary}--\r\n")
        out.toByteArray()
    }
}
