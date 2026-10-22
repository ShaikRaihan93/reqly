package com.reqly.entity

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

    @Column(columnDefinition = "TEXT")
    String variables

    /** JSON array of variable names whose values are masked in the UI */
    @Column(columnDefinition = "TEXT")
    String secrets

    @Column(name = "created_at")
    LocalDateTime createdAt = LocalDateTime.now()

    @Column(name = "updated_at")
    LocalDateTime updatedAt = LocalDateTime.now()

    @PreUpdate
    void preUpdate() {
        this.updatedAt = LocalDateTime.now()
    }
}
