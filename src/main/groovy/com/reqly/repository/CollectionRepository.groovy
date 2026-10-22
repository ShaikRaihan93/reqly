package com.reqly.repository

import com.reqly.entity.Collection
import org.springframework.data.jpa.repository.JpaRepository

interface CollectionRepository extends JpaRepository<Collection, Long> {
    List<Collection> findByParentIsNullOrderBySortOrder()
    List<Collection> findByParentIdOrderBySortOrder(Long parentId)
}
