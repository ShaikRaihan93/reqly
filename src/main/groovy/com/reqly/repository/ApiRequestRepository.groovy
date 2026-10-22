package com.reqly.repository

import com.reqly.entity.ApiRequest
import com.reqly.entity.AppUser
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface ApiRequestRepository extends JpaRepository<ApiRequest, Long> {
    List<ApiRequest> findByCollectionIdOrderBySortOrder(Long collectionId)
    List<ApiRequest> findByCollectionIsNullAndOwnerIdOrderBySortOrder(Long ownerId)
    List<ApiRequest> findByOwnerId(Long ownerId)

    @Modifying
    @Query("update ApiRequest r set r.owner = :u where r.owner is null")
    int claimUnowned(@Param("u") AppUser u)
}
