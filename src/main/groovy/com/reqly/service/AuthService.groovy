package com.reqly.service

import com.reqly.entity.AppUser
import com.reqly.entity.AuthSession
import com.reqly.repository.*
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

import java.security.MessageDigest
import java.security.SecureRandom
import java.time.LocalDateTime
import java.util.concurrent.ConcurrentHashMap

/** Local accounts: sign-up, sign-in with persistent sessions, password changes. */
@Service
class AuthService {

    static final int MIN_PASSWORD = 8
    private static final int MAX_ATTEMPTS = 5
    private static final long LOCK_MS = 60_000

    private final AppUserRepository users
    private final AuthSessionRepository sessions
    private final CollectionRepository collections
    private final ApiRequestRepository requests
    private final EnvironmentRepository environments
    private final RequestHistoryRepository history
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12)
    private final SecureRandom random = new SecureRandom()
    /** email -> [failures, firstFailureAt]; slows down password guessing */
    private final Map<String, long[]> failures = new ConcurrentHashMap<>()

    AuthService(AppUserRepository users, AuthSessionRepository sessions, CollectionRepository collections,
                ApiRequestRepository requests, EnvironmentRepository environments, RequestHistoryRepository history) {
        this.users = users
        this.sessions = sessions
        this.collections = collections
        this.requests = requests
        this.environments = environments
        this.history = history
    }

    boolean hasUsers() { users.count() > 0 }

    /** Creates an account. The very first account inherits any data created before accounts existed. */
    @Transactional
    AppUser signUp(String name, String email, String password) {
        name = name?.trim()
        email = email?.trim()?.toLowerCase()
        if (!name) throw new IllegalArgumentException("Please enter your name")
        if (!(email ==~ /^[^\s@]+@[^\s@]+\.[^\s@]+$/)) throw new IllegalArgumentException("Please enter a valid email address")
        validatePassword(password)
        if (users.findByEmailIgnoreCase(email).isPresent()) throw new IllegalArgumentException("An account with this email already exists")
        boolean first = !hasUsers()
        def user = users.save(new AppUser(name: name, email: email, passwordHash: encoder.encode(password)))
        if (first) {
            collections.claimUnowned(user)
            requests.claimUnowned(user)
            environments.claimUnowned(user)
            history.claimUnowned(user)
        }
        user
    }

    /** @return [user, token] where token goes into the session cookie */
    @Transactional
    List signIn(String email, String password, boolean remember) {
        email = email?.trim()?.toLowerCase() ?: ""
        checkLock(email)
        def user = users.findByEmailIgnoreCase(email).orElse(null)
        if (user == null || !encoder.matches(password ?: "", user.passwordHash)) {
            recordFailure(email)
            throw new IllegalArgumentException("Email or password is incorrect")
        }
        failures.remove(email)
        user.lastLoginAt = LocalDateTime.now()
        users.save(user)
        sessions.deleteExpired(LocalDateTime.now())
        [user, createSession(user, remember)]
    }

    String createSession(AppUser user, boolean remember) {
        byte[] bytes = new byte[32]
        random.nextBytes(bytes)
        def token = Base64.urlEncoder.withoutPadding().encodeToString(bytes)
        sessions.save(new AuthSession(tokenHash: hash(token), user: user,
                expiresAt: LocalDateTime.now().plusDays(remember ? 30 : 1)))
        token
    }

    AppUser userForToken(String token) {
        if (!token) return null
        def s = sessions.findByTokenHash(hash(token)).orElse(null)
        if (s == null || s.expiresAt.isBefore(LocalDateTime.now())) return null
        s.user
    }

    @Transactional
    void signOut(String token) {
        if (token) sessions.findByTokenHash(hash(token)).ifPresent { sessions.delete(it) }
    }

    /** Changes the password and signs out every other session of this user. */
    @Transactional
    void changePassword(AppUser user, String current, String next, String keepToken) {
        def fresh = users.findById(user.id).orElseThrow()
        if (!encoder.matches(current ?: "", fresh.passwordHash)) throw new IllegalArgumentException("Your current password is incorrect")
        validatePassword(next)
        fresh.passwordHash = encoder.encode(next)
        users.save(fresh)
        sessions.deleteOthers(fresh.id, hash(keepToken ?: ""))
    }

    @Transactional
    AppUser updateProfile(AppUser user, String name) {
        def fresh = users.findById(user.id).orElseThrow()
        if (!name?.trim()) throw new IllegalArgumentException("Please enter your name")
        fresh.name = name.trim()
        users.save(fresh)
    }

    private static void validatePassword(String password) {
        if (!password || password.length() < MIN_PASSWORD) throw new IllegalArgumentException("Use at least ${MIN_PASSWORD} characters for your password".toString())
        if (password.length() > 200) throw new IllegalArgumentException("That password is too long")
    }

    private void checkLock(String email) {
        def f = failures[email]
        if (f && f[0] >= MAX_ATTEMPTS && System.currentTimeMillis() - f[1] < LOCK_MS) {
            throw new TooManyAttemptsException("Too many attempts. Wait a minute and try again.")
        }
        if (f && System.currentTimeMillis() - f[1] >= LOCK_MS) failures.remove(email)
    }

    private void recordFailure(String email) {
        failures.compute(email) { k, v -> v ? [v[0] + 1, v[1]] as long[] : [1L, System.currentTimeMillis()] as long[] }
    }

    static String hash(String token) {
        MessageDigest.getInstance("SHA-256").digest(token.getBytes("UTF-8")).encodeHex().toString()
    }

    static class TooManyAttemptsException extends RuntimeException {
        TooManyAttemptsException(String m) { super(m) }
    }
}
