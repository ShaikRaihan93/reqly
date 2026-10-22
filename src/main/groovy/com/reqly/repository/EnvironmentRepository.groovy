package com.reqly.repository

import com.reqly.entity.Environment
import com.reqly.entity.AppUser
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface EnvironmentRepository extends JpaRepository<Environment, Long> {
    List<Environment> findByOwnerIdOrderById(Long ownerId)

    @Modifying
    @Query("update Environment e set e.owner = :u where e.owner is null")
    int claimUnowned(@Param("u") AppUser u)
}
