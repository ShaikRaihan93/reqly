package com.reqly.repository

import com.reqly.entity.ApiRequest
import org.springframework.data.jpa.repository.JpaRepository

interface ApiRequestRepository extends JpaRepository<ApiRequest, Long> {
    List<ApiRequest> findByCollectionIdOrderBySortOrder(Long collectionId)
    List<ApiRequest> findByCollectionIsNullOrderBySortOrder()
}
