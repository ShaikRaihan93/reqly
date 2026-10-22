package com.reqly.entity

import com.fasterxml.jackson.annotation.JsonIgnore
import com.reqly.security.EncryptedStringConverter
import jakarta.persistence.*
import java.time.LocalDateTime

@Entity
@Table(name = "environments")
class Environment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id

    @Column(nullable = false)
    String name

    @Convert(converter = EncryptedStringConverter)
    @Column(columnDefinition = "TEXT")
    String variables

    /** JSON array of variable names whose values are masked in the UI */
    @Column(columnDefinition = "TEXT")
    String secrets

    /** Account this belongs to; every query is scoped to the signed-in user */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id")
    @JsonIgnore
    AppUser owner

    @Column(name = "created_at")
    LocalDateTime createdAt = LocalDateTime.now()

    @Column(name = "updated_at")
    LocalDateTime updatedAt = LocalDateTime.now()

    @PreUpdate
    void preUpdate() {
        this.updatedAt = LocalDateTime.now()
    }
}
