package com.reqly.dto

class BulkExecutionSummary {
    int totalRequests
    int successCount
    int failCount
    long avgResponseTimeMs
    long minResponseTimeMs
    long maxResponseTimeMs
    long p95ResponseTimeMs
    double requestsPerSecond
    long totalDurationMs
    List<StatusCodeBreakdown> statusBreakdown
    List<ExecutionResult> results

    static class StatusCodeBreakdown {
        int statusCode
        int count
        double percentage
    }
}
