package com.reqly.entity

import jakarta.persistence.*
import java.time.LocalDateTime

/** Sign-in session. Only a SHA-256 hash of the cookie token is stored, so a copied database can't be used to log in. */
@Entity
@Table(name = "auth_sessions")
class AuthSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    String tokenHash

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "user_id")
    AppUser user

    @Column(name = "expires_at", nullable = false)
    LocalDateTime expiresAt

    @Column(name = "created_at")
    LocalDateTime createdAt = LocalDateTime.now()
}
