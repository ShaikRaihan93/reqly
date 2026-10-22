package com.reqly.config

import com.reqly.repository.AppUserRepository
import com.reqly.repository.AuthSessionRepository
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional

import java.security.SecureRandom

/**
 * Accounts are local, so there's no reset email. Starting Reqly with
 * {@code --reqly.reset-password=you@example.com} sets a temporary password, prints it, and signs that
 * account out everywhere. Only someone who can start the app on this machine can do this.
 */
@Component
class PasswordResetRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetRunner)
    private static final String ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    private final AppUserRepository users
    private final AuthSessionRepository sessions

    @Value('${reqly.reset-password:}')
    String resetEmail

    PasswordResetRunner(AppUserRepository users, AuthSessionRepository sessions) {
        this.users = users
        this.sessions = sessions
    }

    @Override
    @Transactional
    void run(ApplicationArguments args) {
        if (!resetEmail) return
        def user = users.findByEmailIgnoreCase(resetEmail.trim()).orElse(null)
        if (user == null) {
            log.warn("Password reset: no account with email {}", resetEmail)
            return
        }
        def random = new SecureRandom()
        def temp = (1..14).collect { ALPHABET[random.nextInt(ALPHABET.length())] }.join("")
        user.passwordHash = new BCryptPasswordEncoder(12).encode(temp)
        users.save(user)
        sessions.findAll().findAll { it.user.id == user.id }.each { sessions.delete(it) }
        def banner = """
            |==============================================================
            |  Reqly password reset for ${user.email}
            |  Temporary password:  ${temp}
            |  Sign in with it, then change it under your account menu.
            |==============================================================""".stripMargin()
        System.out.println(banner)
        log.warn("Password reset for {}; temporary password printed to the console", user.email)
    }
}
