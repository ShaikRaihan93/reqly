package com.reqly.dto

class ExecutionResult {
    boolean success
    int statusCode
    String responseBody
    Map<String, String> responseHeaders
    long responseTimeMs
    long responseSizeBytes
    String error
    List<TestResult> testResults
    /** Values saved from the response into the environment ({@code json.x -> name} lines in Tests) */
    List<Map<String, Object>> captures
    String captureEnvironment
    int csvRow
}
