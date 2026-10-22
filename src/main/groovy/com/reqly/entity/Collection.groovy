package com.reqly.entity

import com.fasterxml.jackson.annotation.JsonIgnore
import jakarta.persistence.*
import java.time.LocalDateTime

@Entity
@Table(name = "collections")
class Collection {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id

    @Column(nullable = false)
    String name

    String description

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    @JsonIgnore
    Collection parent

    @OneToMany(mappedBy = "parent", cascade = CascadeType.ALL, orphanRemoval = true)
    List<Collection> children = []

    @OneToMany(mappedBy = "collection", cascade = CascadeType.ALL, orphanRemoval = true)
    @JsonIgnore
    List<ApiRequest> requests = []

    /** Account this belongs to; every query is scoped to the signed-in user */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id")
    @JsonIgnore
    AppUser owner

    @Column(name = "sort_order")
    Integer sortOrder = 0

    @Column(name = "created_at")
    LocalDateTime createdAt = LocalDateTime.now()

    @Column(name = "updated_at")
    LocalDateTime updatedAt = LocalDateTime.now()

    @PreUpdate
    void preUpdate() {
        this.updatedAt = LocalDateTime.now()
    }
}
