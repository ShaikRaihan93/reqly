package com.reqly.service

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.reqly.dto.ExecutionResult
import com.reqly.dto.TestResult
import org.springframework.stereotype.Service

import java.util.regex.Pattern

@Service
class TestRunner {

    private final ObjectMapper objectMapper = new ObjectMapper()

    List<TestResult> runTests(String testScript, ExecutionResult execution) {
        if (!testScript?.trim()) return []

        testScript.split("\\n")
            .collect { it.trim() }
            .findAll { it && !it.startsWith("//") && !it.startsWith("#") && !(it ==~ CAPTURE) }
            .collect { evaluateTest(it, execution) }
    }

    /** `source -> variableName`, e.g. `json.data.token -> token` or `header.X-Request-Id -> requestId` */
    static final java.util.regex.Pattern CAPTURE = ~/^(.+?)\s*->\s*([A-Za-z_][\w.-]*)$/

    /** Evaluates capture lines; each entry is [name, source, value, ok, message]. */
    List<Map<String, Object>> captureValues(String testScript, ExecutionResult exec) {
        if (!testScript?.trim() || !exec.success) return []
        testScript.split("\\n").collect { it.trim() }.findAll { it && !it.startsWith("//") && !it.startsWith("#") }.collect { line ->
            def m = line =~ CAPTURE
            if (!m.matches()) return null
            String source = m.group(1).trim(), name = m.group(2)
            try {
                String value = extract(source, exec)
                value != null
                    ? [name: name, source: source, value: value, ok: true]
                    : [name: name, source: source, ok: false, message: "${source} was not found in the response".toString()]
            } catch (Exception e) {
                [name: name, source: source, ok: false, message: "Could not read ${source}: ${e.message}".toString()]
            }
        }.findAll()
    }

    private String extract(String source, ExecutionResult exec) {
        if (source == "status") return String.valueOf(exec.statusCode)
        if (source == "responseTime") return String.valueOf(exec.responseTimeMs)
        if (source == "body") return exec.responseBody
        if (source.startsWith("header.")) {
            def name = source.substring("header.".length())
            return exec.responseHeaders?.find { k, v -> k.equalsIgnoreCase(name) }?.value
        }
        if (source.startsWith("json.")) {
            def path = source.substring("json.".length())
            def root = objectMapper.readTree(exec.responseBody)
            if (path.endsWith(".length")) {
                def arr = navigateJson(root, path.substring(0, path.lastIndexOf(".length")))
                return arr?.isArray() ? String.valueOf(arr.size()) : null
            }
            def node = navigateJson(root, path)
            if (node == null || node.isMissingNode()) return null
            return node.isValueNode() ? (node.isNull() ? null : node.asText()) : node.toString()
        }
        throw new IllegalArgumentException("use json.<path>, header.<name>, status, responseTime or body")
    }

    private TestResult evaluateTest(String line, ExecutionResult exec) {
        def result = new TestResult(testName: line)

        try {
            if (line.startsWith("status")) {
                evaluateStatusTest(line, exec, result)
            } else if (line.startsWith("responseTime")) {
                evaluateResponseTimeTest(line, exec, result)
            } else if (line.startsWith("body ")) {
                evaluateBodyTest(line, exec, result)
            } else if (line.startsWith("header.")) {
                evaluateHeaderTest(line, exec, result)
            } else if (line.startsWith("json.")) {
                evaluateJsonTest(line, exec, result)
            } else {
                result.passed = false
                result.message = "Unknown test assertion: ${line}"
            }
        } catch (Exception e) {
            result.passed = false
            result.message = "Error: ${e.message}"
        }
        result
    }

    private void evaluateStatusTest(String line, ExecutionResult exec, TestResult result) {
        def rest = line.substring("status".length()).trim()
        if (rest.startsWith("==")) {
            int expected = Integer.parseInt(rest.substring(2).trim())
            result.passed = exec.statusCode == expected
            result.message = "Expected status ${expected}, got ${exec.statusCode}"
        } else if (rest.startsWith("!=")) {
            int notExpected = Integer.parseInt(rest.substring(2).trim())
            result.passed = exec.statusCode != notExpected
            result.message = "Expected status not ${notExpected}, got ${exec.statusCode}"
        } else if (rest.startsWith("<")) {
            int threshold = Integer.parseInt(rest.substring(1).trim())
            result.passed = exec.statusCode < threshold
            result.message = "Expected status < ${threshold}, got ${exec.statusCode}"
        } else if (rest.startsWith(">")) {
            int threshold = Integer.parseInt(rest.substring(1).trim())
            result.passed = exec.statusCode > threshold
            result.message = "Expected status > ${threshold}, got ${exec.statusCode}"
        }
    }

    private void evaluateResponseTimeTest(String line, ExecutionResult exec, TestResult result) {
        def rest = line.substring("responseTime".length()).trim()
        def actual = exec.responseTimeMs
        if (rest.startsWith("<")) {
            long threshold = Long.parseLong(rest.substring(1).trim())
            result.passed = actual < threshold
            result.message = "Expected responseTime < ${threshold}ms, got ${actual}ms"
        } else if (rest.startsWith(">")) {
            long threshold = Long.parseLong(rest.substring(1).trim())
            result.passed = actual > threshold
            result.message = "Expected responseTime > ${threshold}ms, got ${actual}ms"
        }
    }

    private void evaluateBodyTest(String line, ExecutionResult exec, TestResult result) {
        def rest = line.substring("body".length()).trim()
        def body = exec.responseBody ?: ""

        if (rest.startsWith("contains ")) {
            def expected = extractQuoted(rest.substring("contains".length()).trim())
            result.passed = body.contains(expected)
            result.message = result.passed ? "Body contains \"${expected}\"" : "Body does not contain \"${expected}\""
        } else if (rest.startsWith("notContains ")) {
            def notExpected = extractQuoted(rest.substring("notContains".length()).trim())
            result.passed = !body.contains(notExpected)
            result.message = result.passed ? "Body does not contain \"${notExpected}\"" : "Body contains \"${notExpected}\""
        } else if (rest.startsWith("matches ")) {
            def regex = extractQuoted(rest.substring("matches".length()).trim())
            result.passed = Pattern.compile(regex).matcher(body).find()
            result.message = result.passed ? "Body matches pattern" : "Body does not match pattern: ${regex}"
        }
    }

    private void evaluateHeaderTest(String line, ExecutionResult exec, TestResult result) {
        def rest = line.substring("header.".length())
        def spaceIdx = rest.indexOf(' ')
        def headerName = rest.substring(0, spaceIdx).trim()
        def assertion = rest.substring(spaceIdx).trim()

        // header names are case-insensitive (servers send Content-Type, content-type, ...)
        def headerValue = exec.responseHeaders?.find { k, v -> k.equalsIgnoreCase(headerName) }?.value ?: ""

        if (assertion.startsWith("contains ")) {
            def expected = extractQuoted(assertion.substring("contains".length()).trim())
            result.passed = headerValue.contains(expected)
            result.message = "Header ${headerName}: ${result.passed ? 'contains' : 'does not contain'} \"${expected}\""
        } else if (assertion.startsWith("==")) {
            def expected = extractQuoted(assertion.substring(2).trim())
            result.passed = headerValue == expected
            result.message = "Header ${headerName}: expected \"${expected}\", got \"${headerValue}\""
        } else {
            result.passed = false
            result.message = "Unknown header assertion: use contains \"text\" or == \"value\""
        }
    }

    private void evaluateJsonTest(String line, ExecutionResult exec, TestResult result) {
        try {
            def rest = line.substring("json.".length())
            def parts = rest.split("\\s+(==|!=|contains|>|<|>=|<=)\\s+", 2)
            def path = parts[0].trim()
            def assertionPart = rest.substring(path.length()).trim()

            def root = objectMapper.readTree(exec.responseBody)

            String operator
            String expected
            if (assertionPart.startsWith("==")) {
                operator = "=="
                expected = extractQuoted(assertionPart.substring(2).trim())
            } else if (assertionPart.startsWith("!=")) {
                operator = "!="
                expected = extractQuoted(assertionPart.substring(2).trim())
            } else if (assertionPart.startsWith(">=")) {
                operator = ">="
                expected = assertionPart.substring(2).trim()
            } else if (assertionPart.startsWith("<=")) {
                operator = "<="
                expected = assertionPart.substring(2).trim()
            } else if (assertionPart.startsWith(">")) {
                operator = ">"
                expected = assertionPart.substring(1).trim()
            } else if (assertionPart.startsWith("<")) {
                operator = "<"
                expected = assertionPart.substring(1).trim()
            } else if (assertionPart.startsWith("contains ")) {
                operator = "contains"
                expected = extractQuoted(assertionPart.substring("contains".length()).trim())
            } else {
                result.passed = false
                result.message = "Unknown operator in: ${line}"
                return
            }

            String actual
            if (path.endsWith(".length")) {
                def arrayPath = path.substring(0, path.lastIndexOf(".length"))
                def arrayNode = navigateJson(root, arrayPath)
                actual = String.valueOf(arrayNode?.isArray() ? arrayNode.size() : 0)
            } else {
                def node = navigateJson(root, path)
                actual = node != null ? node.asText() : "null"
            }

            boolean passed
            switch (operator) {
                case "==": passed = actual == expected; break
                case "!=": passed = actual != expected; break
                case ">": passed = Double.parseDouble(actual) > Double.parseDouble(expected); break
                case "<": passed = Double.parseDouble(actual) < Double.parseDouble(expected); break
                case ">=": passed = Double.parseDouble(actual) >= Double.parseDouble(expected); break
                case "<=": passed = Double.parseDouble(actual) <= Double.parseDouble(expected); break
                case "contains": passed = actual.contains(expected); break
                default: passed = false
            }

            result.passed = passed
            result.message = "json.${path} ${operator} ${expected} (actual: ${actual})"

        } catch (Exception e) {
            result.passed = false
            result.message = "JSON test error: ${e.message}"
        }
    }

    private JsonNode navigateJson(JsonNode root, String path) {
        def current = root
        for (seg in path.split("\\.")) {
            if (seg == "length") break
            if (current == null) return null
            if (current.isArray()) {
                try {
                    current = current.get(Integer.parseInt(seg))
                } catch (NumberFormatException e) {
                    return null
                }
            } else {
                current = current.get(seg)
            }
        }
        current
    }

    private String extractQuoted(String s) {
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            return s.substring(1, s.length() - 1)
        }
        s
    }
}
