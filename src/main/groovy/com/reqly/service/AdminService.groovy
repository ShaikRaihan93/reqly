package com.reqly.service

import com.reqly.config.DatabaseBackup
import com.reqly.entity.AppUser
import com.reqly.repository.AppUserRepository
import com.reqly.repository.AuthSessionRepository
import com.reqly.security.CurrentUser
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

import javax.sql.DataSource
import java.lang.management.ManagementFactory
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.security.SecureRandom
import java.sql.Clob
import java.sql.ResultSet
import java.util.regex.Pattern

/**
 * Admin dashboard: database overview, table browser, a read-only SQL console, users and backups.
 * Secrets never leave the server in readable form: password/token hashes and encrypted values are masked.
 */
@Service
class AdminService {

    static final int MAX_ROWS = 1000
    static final int MAX_CELL = 5000
    private static final Set<String> SECRET_COLUMNS = ["PASSWORD_HASH", "TOKEN_HASH"] as Set
    /** First keyword of statements the SQL console accepts */
    private static final Pattern READ_ONLY_START = ~/(?is)^\s*(select|with|explain|show|values|table)\b.*/
    /** Anything that writes, changes settings or touches files (H2 functions included) */
    private static final Pattern FORBIDDEN = ~/(?i)\b(insert|update|delete|merge|upsert|truncate|create|alter|drop|grant|revoke|set|call|runscript|script|backup|shutdown|commit|rollback|lock|file_read|file_write|csvread|csvwrite|link_schema|java_object|lob)\b/

    private final JdbcTemplate jdbc
    private final DataSource dataSource
    private final AppUserRepository users
    private final AuthSessionRepository sessions
    private final DatabaseBackup backup
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12)

    AdminService(JdbcTemplate jdbc, DataSource dataSource, AppUserRepository users, AuthSessionRepository sessions, DatabaseBackup backup) {
        this.jdbc = jdbc
        this.dataSource = dataSource
        this.users = users
        this.sessions = sessions
        this.backup = backup
    }

    // ---------- Overview ----------

    Map<String, Object> overview() {
        def count = { String t -> jdbc.queryForObject("SELECT COUNT(*) FROM ${t}".toString(), Long) }
        def dbFile = databaseFile()
        def migrations = []
        try {
            migrations = jdbc.queryForList('SELECT "version", "description", "installed_on", "success" FROM "flyway_schema_history" ORDER BY "installed_rank"')
                    .collect { [version: it.version, description: it.description, installedOn: it.installed_on?.toString(), success: it.success] }
        } catch (ignored) { /* no Flyway */ }
        def runtime = ManagementFactory.runtimeMXBean
        def mem = Runtime.runtime
        [
            counts      : [users: count("app_users"), collections: count("collections"), requests: count("api_requests"),
                           environments: count("environments"), history: count("request_history"), sessions: count("auth_sessions")],
            database    : [product: dataSource.connection.withCloseable { "${it.metaData.databaseProductName} ${it.metaData.databaseProductVersion}".toString() },
                           file: dbFile?.toString(), sizeBytes: dbFile && Files.exists(dbFile) ? Files.size(dbFile) : null,
                           schemaVersion: migrations ? migrations.last().version : null],
            migrations  : migrations,
            server      : [startedAt: new Date(runtime.startTime).toInstant().toString(), uptimeMs: runtime.uptime,
                           java: "${System.getProperty('java.vendor')} ${System.getProperty('java.version')}".toString(),
                           memoryUsedMb: ((mem.totalMemory() - mem.freeMemory()) / 1048576) as long, memoryMaxMb: (mem.maxMemory() / 1048576) as long,
                           dataDir: dataDir().toString()],
            backups     : listBackups(),
        ] as Map<String, Object>
    }

    // ---------- Tables ----------

    List<Map<String, Object>> tables() {
        jdbc.queryForList("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'PUBLIC' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME", String)
                .collect { name ->
                    [name: name, rows: jdbc.queryForObject("SELECT COUNT(*) FROM ${quote(name)}".toString(), Long), columns: columns(name)]
                } as List<Map<String, Object>>
    }

    private List<Map<String, Object>> columns(String table) {
        jdbc.queryForList("SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'PUBLIC' AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", table)
                .collect { [name: it.COLUMN_NAME, type: it.DATA_TYPE, nullable: it.IS_NULLABLE == 'YES', secret: SECRET_COLUMNS.contains((it.COLUMN_NAME as String).toUpperCase())] } as List<Map<String, Object>>
    }

    /** One page of a table. Table and sort column are checked against the schema, so nothing user-typed reaches SQL as an identifier. */
    Map<String, Object> rows(String table, int page, int size, String q, String sort, String dir) {
        def known = jdbc.queryForList("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'PUBLIC' AND TABLE_TYPE = 'BASE TABLE'", String)
        if (!known.contains(table)) throw new NoSuchElementException("No such table")
        def cols = columns(table)
        size = Math.min(Math.max(size, 1), 500)
        page = Math.max(page, 0)
        def args = []
        def where = ""
        if (q?.trim()) {
            def searchable = cols.findAll { !it.secret }
            where = " WHERE " + searchable.collect { "CAST(${quote(it.name as String)} AS VARCHAR) ILIKE ?" }.join(" OR ")
            searchable.each { args << "%${q.trim()}%".toString() }
        }
        def order = cols.find { it.name == sort } ? " ORDER BY ${quote(sort)} ${dir?.equalsIgnoreCase('desc') ? 'DESC' : 'ASC'}" : (cols.find { it.name == 'ID' } ? ' ORDER BY "ID" DESC' : '')
        def total = jdbc.queryForObject("SELECT COUNT(*) FROM ${quote(table)}${where}".toString(), Long, *args)
        def data = jdbc.query("SELECT * FROM ${quote(table)}${where}${order} LIMIT ${size} OFFSET ${page * size}".toString(),
                { ResultSet rs, int i -> readRow(rs) } as org.springframework.jdbc.core.RowMapper, *args)
        [table: table, columns: cols, rows: data, total: total, page: page, size: size] as Map<String, Object>
    }

    // ---------- Read-only SQL console ----------

    Map<String, Object> query(String sql) {
        def text = (sql ?: "").trim().replaceAll(/;+\s*$/, "")
        if (!text) throw new IllegalArgumentException("Type a query")
        if (text.contains(";")) throw new IllegalArgumentException("Run one statement at a time")
        def stripped = text.replaceAll(/'(?:[^']|'')*'/, "''") // keywords inside string literals don't count
        if (!(stripped ==~ READ_ONLY_START)) throw new IllegalArgumentException("The console is read-only: start with SELECT, WITH, EXPLAIN, SHOW, VALUES or TABLE")
        def bad = stripped =~ FORBIDDEN
        if (bad.find()) throw new IllegalArgumentException("\"${bad.group(1).toUpperCase()}\" isn't allowed in the read-only console".toString())
        long start = System.currentTimeMillis()
        dataSource.connection.withCloseable { conn ->
            conn.readOnly = true
            conn.autoCommit = false
            try {
                conn.createStatement().withCloseable { st ->
                    st.queryTimeout = 10
                    st.maxRows = MAX_ROWS + 1
                    st.executeQuery(text).withCloseable { rs ->
                        def md = rs.metaData
                        def names = (1..md.columnCount).collect { md.getColumnLabel(it) }
                        def out = []
                        while (rs.next() && out.size() <= MAX_ROWS) out << readRow(rs)
                        def truncated = out.size() > MAX_ROWS
                        if (truncated) out = out.take(MAX_ROWS)
                        [columns: names.collect { [name: it, secret: SECRET_COLUMNS.contains(it.toUpperCase())] }, rows: out,
                         truncated: truncated, ms: System.currentTimeMillis() - start] as Map<String, Object>
                    }
                }
            } finally {
                conn.rollback()
            }
        }
    }

    private static Map<String, Object> readRow(ResultSet rs) {
        def md = rs.metaData
        def row = new LinkedHashMap<String, Object>()
        for (int c = 1; c <= md.columnCount; c++) {
            def name = md.getColumnLabel(c)
            def v = rs.getObject(c)
            if (v instanceof Clob) v = v.getSubString(1, (int) Math.min(v.length(), MAX_CELL + 1))
            if (v instanceof byte[]) v = "<${v.length} bytes>".toString()
            if (v != null && !(v instanceof Number) && !(v instanceof Boolean)) v = v.toString()
            row[name] = mask(name, v)
        }
        row
    }

    private static Object mask(String column, Object v) {
        if (v == null) return null
        if (SECRET_COLUMNS.contains(column.toUpperCase())) return [masked: "hash"]
        if (v instanceof String && v.startsWith("enc:v1:")) return [masked: "encrypted"]
        if (v instanceof String && v.length() > MAX_CELL) return v.substring(0, MAX_CELL) + "…"
        v
    }

    // ---------- Users ----------

    List<Map<String, Object>> listUsers() {
        def counts = { String table -> jdbc.queryForList("SELECT owner_id AS O, COUNT(*) AS N FROM ${table} GROUP BY owner_id".toString()).collectEntries { [it.O, it.N] } }
        def cols = counts("collections"), reqs = counts("api_requests"), envs = counts("environments"), hist = counts("request_history")
        def sess = jdbc.queryForList("SELECT user_id AS U, COUNT(*) AS N FROM auth_sessions WHERE expires_at > CURRENT_TIMESTAMP GROUP BY user_id").collectEntries { [it.U, it.N] }
        users.findAll().sort { it.id }.collect { u ->
            [id: u.id, name: u.name, email: u.email, admin: u.admin == true, createdAt: u.createdAt?.toString(), lastLoginAt: u.lastLoginAt?.toString(),
             collections: cols[u.id] ?: 0, requests: reqs[u.id] ?: 0, environments: envs[u.id] ?: 0, history: hist[u.id] ?: 0,
             activeSessions: sess[u.id] ?: 0, you: u.id == CurrentUser.id()]
        } as List<Map<String, Object>>
    }

    @Transactional
    void setAdmin(Long id, boolean admin) {
        def u = users.findById(id).orElseThrow()
        if (!admin && u.admin && users.findAll().count { it.admin } <= 1) throw new IllegalArgumentException("There must be at least one admin")
        u.admin = admin
        users.save(u)
    }

    @Transactional
    int signOutEverywhere(Long id) {
        jdbc.update("DELETE FROM auth_sessions WHERE user_id = ?", id)
    }

    /** Sets a random temporary password, signs the user out everywhere and returns the password (shown once). */
    @Transactional
    String resetPassword(Long id) {
        def u = users.findById(id).orElseThrow()
        def alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        def random = new SecureRandom()
        def temp = (1..14).collect { alphabet[random.nextInt(alphabet.length())] }.join("")
        u.passwordHash = encoder.encode(temp)
        users.save(u)
        signOutEverywhere(id)
        temp
    }

    /** Deletes an account and everything in its workspace. */
    @Transactional
    void deleteUser(Long id) {
        if (id == CurrentUser.id()) throw new IllegalArgumentException("You can't delete your own account here")
        def u = users.findById(id).orElseThrow()
        if (u.admin && users.findAll().count { it.admin } <= 1) throw new IllegalArgumentException("There must be at least one admin")
        jdbc.update("DELETE FROM request_history WHERE owner_id = ? OR request_id IN (SELECT id FROM api_requests WHERE owner_id = ?)", id, id)
        jdbc.update("DELETE FROM api_requests WHERE owner_id = ?", id)
        // collections reference their parent, so remove leaves first
        while (jdbc.update("DELETE FROM collections WHERE owner_id = ? AND id NOT IN (SELECT parent_id FROM collections WHERE parent_id IS NOT NULL)", id) > 0) { }
        jdbc.update("DELETE FROM environments WHERE owner_id = ?", id)
        jdbc.update("DELETE FROM auth_sessions WHERE user_id = ?", id)
        jdbc.update("DELETE FROM app_users WHERE id = ?", id)
    }

    // ---------- Backups ----------

    List<Map<String, Object>> listBackups() {
        def dir = DatabaseBackup.backupDir()
        if (!Files.isDirectory(dir)) return []
        Files.list(dir).withCloseable { s ->
            s.filter { it.fileName.toString() ==~ /[\w.-]+\.(zip|mv\.db)/ }
             .sorted(Comparator.comparing { Path p -> Files.getLastModifiedTime(p) }.reversed())
             .collect { p -> [name: p.fileName.toString(), sizeBytes: Files.size(p), modified: Files.getLastModifiedTime(p).toInstant().toString()] }
             .toList()
        } as List<Map<String, Object>>
    }

    Map<String, Object> backupNow() {
        def file = backup.backupNow()
        if (file == null) throw new IllegalArgumentException("Backups are only available for the built-in H2 database")
        [name: file.fileName.toString(), sizeBytes: Files.size(file)] as Map<String, Object>
    }

    Path backupFile(String name) {
        if (!(name ==~ /[\w.-]+\.(zip|mv\.db)/)) throw new NoSuchElementException("No such backup")
        def file = DatabaseBackup.backupDir().resolve(name).normalize()
        if (!file.startsWith(DatabaseBackup.backupDir()) || !Files.exists(file)) throw new NoSuchElementException("No such backup")
        file
    }

    // ---------- Helpers ----------

    private static String quote(String identifier) { '"' + identifier.replace('"', '""') + '"' }

    private static Path dataDir() {
        Paths.get(System.getProperty("reqly.data-dir") ?: Paths.get(System.getProperty("user.home"), "reqly-data").toString())
    }

    private Path databaseFile() {
        def url = dataSource.connection.withCloseable { it.metaData.URL }
        def m = url =~ /jdbc:h2:file:([^;]+)/
        if (!m.find()) return null
        Paths.get(m.group(1).replaceFirst(/^~/, System.getProperty("user.home")) + ".mv.db")
    }
}
