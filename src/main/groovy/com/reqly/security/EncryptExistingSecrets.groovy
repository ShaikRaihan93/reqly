package com.reqly.security

import org.slf4j.Logger
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional

/**
 * Encrypted columns only encrypt on save, so values written before encryption existed would stay
 * readable on disk until edited. On every start this encrypts any remaining plaintext in those
 * columns (a no-op once everything is encrypted).
 */
@Component
class EncryptExistingSecrets implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(EncryptExistingSecrets)
    /** table -> encrypted columns (must match the @Convert(EncryptedStringConverter) fields) */
    static final Map<String, List<String>> COLUMNS = [
        environments   : ["variables"],
        api_requests   : ["headers", "auth_config"],
        request_history: ["request_headers"],
    ]

    private final JdbcTemplate jdbc
    private final EncryptedStringConverter converter = new EncryptedStringConverter()

    EncryptExistingSecrets(JdbcTemplate jdbc) {
        this.jdbc = jdbc
    }

    @Override
    @Transactional
    void run(ApplicationArguments args) {
        int total = 0
        COLUMNS.each { table, cols ->
            cols.each { col ->
                def rows = jdbc.queryForList("SELECT id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} NOT LIKE 'enc:v1:%'".toString())
                rows.each { r ->
                    jdbc.update("UPDATE ${table} SET ${col} = ? WHERE id = ?".toString(), converter.convertToDatabaseColumn(r.V as String), r.ID)
                }
                total += rows.size()
            }
        }
        if (total) log.info("Encrypted {} existing plaintext secret value(s) at rest", total)
    }
}
