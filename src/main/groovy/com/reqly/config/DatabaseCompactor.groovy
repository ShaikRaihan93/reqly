package com.reqly.config

import jakarta.annotation.PreDestroy
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

import javax.sql.DataSource

/**
 * H2 keeps superseded pages in the file until it compacts. Compacting on every clean shutdown keeps the
 * file small and scrubs old versions of rows, e.g. secrets from before they were encrypted, or deleted data.
 */
@Component
class DatabaseCompactor {

    private static final Logger log = LoggerFactory.getLogger(DatabaseCompactor)
    private final DataSource dataSource

    DatabaseCompactor(DataSource dataSource) {
        this.dataSource = dataSource
    }

    @PreDestroy
    void compact() {
        try {
            dataSource.connection.withCloseable { conn ->
                if (conn.metaData.databaseProductName != "H2" || !conn.metaData.URL.contains(":file:")) return
                log.info("Compacting database before shutdown")
                conn.createStatement().withCloseable { it.execute("SHUTDOWN COMPACT") }
            }
        } catch (Exception e) {
            log.debug("Database compaction skipped: {}", e.message)
        }
    }
}
