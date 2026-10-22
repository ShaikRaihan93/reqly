package com.reqly.repository

import com.reqly.entity.Environment
import org.springframework.data.jpa.repository.JpaRepository

interface EnvironmentRepository extends JpaRepository<Environment, Long> {
}
