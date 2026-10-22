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

    private final HttpClient httpClient
    private final HttpClient insecureClient

    RequestExecutor() {
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .followRedirects(HttpClient.Redirect.NORMAL)
                .connectTimeout(Duration.ofSeconds(30))
                .build()
        this.insecureClient = createInsecureClient()
    }

    ExecutionResult execute(RequestDto request, Map<String, String> variables) {
        def result = new ExecutionResult()
        long startTime = System.currentTimeMillis()
        String url = request.url

        try {
            url = substituteVariables(buildUrl(request, variables), variables)
            def builder = HttpRequest.newBuilder().uri(URI.create(url))

            // Headers
            def headers = request.headers != null ? new HashMap<>(request.headers) : [:]
            boolean insecure = "true" == headers.remove("_insecure")

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
            def body = request.body != null ? substituteVariables(request.body, variables) : null
            def bodyPublisher = body != null
                    ? HttpRequest.BodyPublishers.ofString(body)
                    : HttpRequest.BodyPublishers.noBody()

            builder.method(request.method.toUpperCase(), bodyPublisher)
            builder.timeout(Duration.ofSeconds(60))

            def httpRequest = builder.build()
            log.info("=== Outgoing Request ===")
            log.info("Method: {} URL: {}", httpRequest.method(), httpRequest.uri())
            log.info("Headers: {}", httpRequest.headers().map())
            log.info("Body: {}", body)
            log.info("BodyType: {} | Insecure: {}", request.bodyType, insecure)
            log.info("========================")

            def client = insecure ? insecureClient : httpClient
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
        if (has(java.net.http.HttpTimeoutException)) return "No response within 60 seconds."
        if (has(ConnectException)) return "Could not connect to ${hostOf(url)}. Check the host and port, that the server is running, and your network/VPN."
        if (has(SSLException)) return "SSL/TLS error: ${detail}. For self-signed certificates, add the header _insecure: true."
        if (e instanceof IllegalArgumentException) return "Invalid URL: ${detail}"
        "${e.class.simpleName}${detail ? ': ' + detail : ''}"
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

    // Variables are substituted before encoding; afterwards "{{x}}" would already be "%7B%7Bx%7D%7D"
    private String buildUrl(RequestDto request, Map<String, String> variables) {
        def url = request.url
        if (request.params) {
            def enc = { String s -> URLEncoder.encode(substituteVariables(s ?: "", variables), StandardCharsets.UTF_8) }
            def queryString = request.params.collect { k, v -> "${enc(k)}=${enc(v)}" }.join("&")
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

    private HttpClient createInsecureClient() {
        try {
            def trustAll = [
                new X509TrustManager() {
                    X509Certificate[] getAcceptedIssuers() { new X509Certificate[0] }
                    void checkClientTrusted(X509Certificate[] certs, String type) {}
                    void checkServerTrusted(X509Certificate[] certs, String type) {}
                }
            ] as TrustManager[]
            def sc = SSLContext.getInstance("TLS")
            sc.init(null, trustAll, new java.security.SecureRandom())
            HttpClient.newBuilder()
                    .version(HttpClient.Version.HTTP_1_1)
                    .sslContext(sc)
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .connectTimeout(Duration.ofSeconds(30))
                    .build()
        } catch (Exception e) {
            httpClient
        }
    }
}
