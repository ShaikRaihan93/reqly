package com.reqly.config

import org.flywaydb.core.Flyway
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.annotation.Bean
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component

import javax.sql.DataSource
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * Takes an online H2 backup into <data dir>/backups on every start and keeps the newest 10.
 * With Flyway it runs before migrations, so a failed migration can always be undone by hand.
 * Does nothing for other databases (e.g. the MariaDB profile).
 * Uses the raw DataSource: JdbcTemplate is only created after Flyway, which would be a cycle.
 */
@Component
class DatabaseBackup {

    private static final Logger log = LoggerFactory.getLogger(DatabaseBackup)
    private static final int KEEP = 10

    private final DataSource dataSource
    private volatile boolean done = false

    DatabaseBackup(DataSource dataSource) {
        this.dataSource = dataSource
    }

    @Bean
    static FlywayMigrationStrategy backupThenMigrate(DatabaseBackup backup) {
        { Flyway flyway -> backup.backupOnce(); flyway.migrate() } as FlywayMigrationStrategy
    }

    /** Also covers setups without Flyway (MariaDB profile). */
    @EventListener(ApplicationReadyEvent)
    void onReady() { backupOnce() }

    synchronized void backupOnce() {
        if (done) return
        done = true
        try {
            dataSource.connection.withCloseable { conn ->
                if (conn.metaData.databaseProductName != "H2") return
                def dataDir = System.getProperty("reqly.data-dir") ?: Paths.get(System.getProperty("user.home"), "reqly-data").toString()
                Path dir = Paths.get(dataDir, "backups")
                Files.createDirectories(dir)
                def file = dir.resolve("reqly-${LocalDateTime.now().format(DateTimeFormatter.ofPattern('yyyyMMdd-HHmmss'))}.zip")
                conn.createStatement().withCloseable { it.execute("BACKUP TO '${file.toString().replace("'", "''")}'") }
                def old = Files.list(dir).withCloseable { s -> s.filter { it.fileName.toString() ==~ /reqly-.*\.zip/ }.sorted().toList() }
                if (old.size() > KEEP) old.take(old.size() - KEEP).each { Files.deleteIfExists(it) }
                log.info("Database backed up to {}", file)
            }
        } catch (Exception e) {
            log.warn("Database backup skipped: {}", e.message)
        }
    }
}
