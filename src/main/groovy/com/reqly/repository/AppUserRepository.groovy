package com.reqly.repository

import com.reqly.entity.AppUser
import org.springframework.data.jpa.repository.JpaRepository

interface AppUserRepository extends JpaRepository<AppUser, Long> {
    Optional<AppUser> findByEmailIgnoreCase(String email)
}
