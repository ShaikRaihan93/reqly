package com.reqly.config

import org.slf4j.Logger
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * Takes an online H2 backup into ~/reqly-data/backups on every start and keeps the newest 10.
 * Does nothing for other databases (e.g. the MariaDB profile).
 */
@Component
class DatabaseBackup {

    private static final Logger log = LoggerFactory.getLogger(DatabaseBackup)
    private static final int KEEP = 10

    private final JdbcTemplate jdbc

    DatabaseBackup(JdbcTemplate jdbc) {
        this.jdbc = jdbc
    }

    @EventListener(ApplicationReadyEvent)
    void backupOnStartup() {
        try {
            def product = jdbc.dataSource.connection.withCloseable { it.metaData.databaseProductName }
            if (product != "H2") return
            Path dir = Paths.get(System.getProperty("user.home"), "reqly-data", "backups")
            Files.createDirectories(dir)
            def file = dir.resolve("reqly-${LocalDateTime.now().format(DateTimeFormatter.ofPattern('yyyyMMdd-HHmmss'))}.zip")
            jdbc.execute("BACKUP TO '${file.toString().replace("'", "''")}'")
            def old = Files.list(dir).withCloseable { s -> s.filter { it.fileName.toString() ==~ /reqly-.*\.zip/ }.sorted().toList() }
            if (old.size() > KEEP) old.take(old.size() - KEEP).each { Files.deleteIfExists(it) }
            log.info("Database backed up to {}", file)
        } catch (Exception e) {
            log.warn("Database backup skipped: {}", e.message)
        }
    }
}
