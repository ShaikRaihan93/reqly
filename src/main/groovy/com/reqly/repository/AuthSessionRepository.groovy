package com.reqly.repository

import com.reqly.entity.AuthSession
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

import java.time.LocalDateTime

interface AuthSessionRepository extends JpaRepository<AuthSession, Long> {
    Optional<AuthSession> findByTokenHash(String tokenHash)

    @Modifying
    @Query("delete from AuthSession s where s.expiresAt < :now")
    int deleteExpired(@Param("now") LocalDateTime now)

    @Modifying
    @Query("delete from AuthSession s where s.user.id = :userId and s.tokenHash <> :keep")
    int deleteOthers(@Param("userId") Long userId, @Param("keep") String keep)
}
