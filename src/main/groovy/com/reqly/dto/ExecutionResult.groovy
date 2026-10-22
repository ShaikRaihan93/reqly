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
    int csvRow
}
