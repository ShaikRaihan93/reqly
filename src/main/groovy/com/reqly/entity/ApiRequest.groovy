package com.reqly.entity

import com.fasterxml.jackson.annotation.JsonIgnore
import com.reqly.security.EncryptedStringConverter
import jakarta.persistence.*
import java.time.LocalDateTime

@Entity
@Table(name = "api_requests")
class ApiRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id

    @Column(nullable = false)
    String name

    @Column(nullable = false)
    String method

    @Column(nullable = false, length = 2048)
    String url

    @Convert(converter = EncryptedStringConverter)
    @Column(columnDefinition = "TEXT")
    String headers

    @Column(columnDefinition = "TEXT")
    String params

    @Column(columnDefinition = "LONGTEXT")
    String body

    @Column(name = "body_type")
    String bodyType

    @Column(name = "auth_type")
    String authType

    @Convert(converter = EncryptedStringConverter)
    @Column(columnDefinition = "TEXT", name = "auth_config")
    String authConfig

    @Column(columnDefinition = "TEXT", name = "test_script")
    String testScript

    @Column(columnDefinition = "TEXT", name = "pre_request_script")
    String preRequestScript

    @Column(columnDefinition = "TEXT", name = "post_response_script")
    String postResponseScript

    /** JSON: {timeoutMs, insecure, followRedirects} */
    @Column(columnDefinition = "TEXT")
    String settings

    // Unchecked params/headers, kept so they survive a save but are never sent
    @Column(columnDefinition = "TEXT", name = "disabled_items")
    String disabledItems

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "collection_id")
    @JsonIgnore
    Collection collection

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "environment_id")
    @JsonIgnore
    Environment environment

    @OneToMany(mappedBy = "apiRequest", cascade = CascadeType.ALL, orphanRemoval = true)
    @JsonIgnore
    List<RequestHistory> history = []

    /** Account this belongs to; every query is scoped to the signed-in user */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id")
    @JsonIgnore
    AppUser owner

    @Column(name = "sort_order")
    Integer sortOrder = 0

    @Column(name = "created_at")
    LocalDateTime createdAt = LocalDateTime.now()

    @Column(name = "updated_at")
    LocalDateTime updatedAt = LocalDateTime.now()

    @PreUpdate
    void preUpdate() {
        this.updatedAt = LocalDateTime.now()
    }
}
