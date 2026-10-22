package com.reqly.entity

import com.fasterxml.jackson.annotation.JsonIgnore
import jakarta.persistence.*
import java.time.LocalDateTime

@Entity
@Table(name = "request_history")
class RequestHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id

    @Column(nullable = false)
    String method

    @Column(nullable = false, length = 2048)
    String url

    @Column(columnDefinition = "TEXT")
    String requestHeaders

    @Column(columnDefinition = "LONGTEXT")
    String requestBody

    @Column(name = "status_code")
    Integer statusCode

    @Column(columnDefinition = "LONGTEXT")
    String responseBody

    @Column(columnDefinition = "TEXT")
    String responseHeaders

    @Column(name = "response_time_ms")
    Long responseTimeMs

    @Column(name = "response_size_bytes")
    Long responseSizeBytes

    @Column(columnDefinition = "TEXT", name = "test_results")
    String testResults

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "request_id")
    @JsonIgnore
    ApiRequest apiRequest

    @Column(name = "executed_at")
    LocalDateTime executedAt = LocalDateTime.now()
}
