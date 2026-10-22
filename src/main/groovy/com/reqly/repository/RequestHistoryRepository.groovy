package com.reqly.repository

import com.reqly.entity.RequestHistory
import org.springframework.data.jpa.repository.JpaRepository

interface RequestHistoryRepository extends JpaRepository<RequestHistory, Long> {
    List<RequestHistory> findByApiRequestIdOrderByExecutedAtDesc(Long requestId)
    List<RequestHistory> findTop100ByOrderByExecutedAtDesc()
}
