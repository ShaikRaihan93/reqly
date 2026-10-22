package com.reqly.repository

import com.reqly.entity.Collection
import com.reqly.entity.AppUser
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface CollectionRepository extends JpaRepository<Collection, Long> {
    List<Collection> findByParentIdOrderBySortOrder(Long parentId)
    List<Collection> findByOwnerId(Long ownerId)
    List<Collection> findByParentIsNullAndOwnerIdOrderBySortOrder(Long ownerId)

    @Modifying
    @Query("update Collection c set c.owner = :u where c.owner is null")
    int claimUnowned(@Param("u") AppUser u)
}
