package com.reqly.entity

import com.fasterxml.jackson.annotation.JsonIgnore
import jakarta.persistence.*
import java.time.LocalDateTime

/** A local Reqly account. Each account has its own workspace (collections, requests, environments, history). */
@Entity
@Table(name = "app_users")
class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id

    @Column(nullable = false)
    String name

    @Column(nullable = false, unique = true)
    String email

    @JsonIgnore
    @Column(name = "password_hash", nullable = false)
    String passwordHash

    @Column(name = "created_at")
    LocalDateTime createdAt = LocalDateTime.now()

    @Column(name = "last_login_at")
    LocalDateTime lastLoginAt

    /** Can open the admin dashboard (/admin). The first account on a machine is an admin. */
    @Column(nullable = false)
    Boolean admin = false
}
