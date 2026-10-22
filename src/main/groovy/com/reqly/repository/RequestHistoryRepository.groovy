package com.reqly.repository

import com.reqly.entity.RequestHistory
import com.reqly.entity.AppUser
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface RequestHistoryRepository extends JpaRepository<RequestHistory, Long> {
    List<RequestHistory> findByApiRequestIdOrderByExecutedAtDesc(Long requestId)
    List<RequestHistory> findTop100ByOwnerIdOrderByExecutedAtDesc(Long ownerId)

    @Modifying
    @Query("delete from RequestHistory h where h.owner.id = :ownerId")
    int deleteByOwner(@Param("ownerId") Long ownerId)

    @Modifying
    @Query("update RequestHistory h set h.owner = :u where h.owner is null")
    int claimUnowned(@Param("u") AppUser u)
}
