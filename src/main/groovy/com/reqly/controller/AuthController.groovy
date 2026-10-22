package com.reqly.controller

import com.reqly.entity.AppUser
import com.reqly.security.CurrentUser
import com.reqly.security.SecurityFilter
import com.reqly.service.AuthService
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpHeaders
import org.springframework.http.ResponseCookie
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

import java.time.Duration

@RestController
@RequestMapping("/api/auth")
class AuthController {

    private final AuthService auth

    AuthController(AuthService auth) {
        this.auth = auth
    }

    @ExceptionHandler(IllegalArgumentException)
    ResponseEntity<Map<String, Object>> badRequest(IllegalArgumentException e) {
        ResponseEntity.badRequest().body([error: e.message] as Map<String, Object>)
    }

    @ExceptionHandler(AuthService.TooManyAttemptsException)
    ResponseEntity<Map<String, Object>> tooMany(AuthService.TooManyAttemptsException e) {
        ResponseEntity.status(429).body([error: e.message] as Map<String, Object>)
    }

    @GetMapping("/status")
    Map<String, Object> status(HttpServletRequest req) {
        def user = auth.userForToken(SecurityFilter.cookie(req))
        [hasUsers: auth.hasUsers(), user: user ? userJson(user) : null] as Map<String, Object>
    }

    @GetMapping("/me")
    ResponseEntity<Map<String, Object>> me(HttpServletRequest req) {
        def user = auth.userForToken(SecurityFilter.cookie(req))
        user ? ResponseEntity.ok(userJson(user)) : ResponseEntity.status(401).body([error: "Please sign in"] as Map<String, Object>)
    }

    @PostMapping("/signup")
    ResponseEntity<Map<String, Object>> signUp(@RequestBody Map<String, Object> body, HttpServletResponse res) {
        def user = auth.signUp(body.name as String, body.email as String, body.password as String)
        def token = auth.createSession(user, body.remember != false)
        setCookie(res, token, body.remember != false)
        ResponseEntity.ok(userJson(user))
    }

    @PostMapping("/signin")
    ResponseEntity<Map<String, Object>> signIn(@RequestBody Map<String, Object> body, HttpServletResponse res) {
        def (AppUser user, String token) = auth.signIn(body.email as String, body.password as String, body.remember == true)
        setCookie(res, token, body.remember == true)
        ResponseEntity.ok(userJson(user))
    }

    @PostMapping("/signout")
    ResponseEntity<Void> signOut(HttpServletRequest req, HttpServletResponse res) {
        auth.signOut(SecurityFilter.cookie(req))
        res.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(SecurityFilter.COOKIE, "").path("/").httpOnly(true).sameSite("Strict").maxAge(0).build().toString())
        ResponseEntity.ok().build()
    }

    @PostMapping("/password")
    ResponseEntity<Void> changePassword(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        def user = requireUser(req)
        auth.changePassword(user, body.current as String, body.next as String, SecurityFilter.cookie(req))
        ResponseEntity.ok().build()
    }

    @PostMapping("/profile")
    Map<String, Object> updateProfile(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        userJson(auth.updateProfile(requireUser(req), body.name as String))
    }

    private AppUser requireUser(HttpServletRequest req) {
        def user = auth.userForToken(SecurityFilter.cookie(req))
        if (user == null) throw new IllegalArgumentException("Please sign in")
        user
    }

    private static void setCookie(HttpServletResponse res, String token, boolean remember) {
        def c = ResponseCookie.from(SecurityFilter.COOKIE, token).path("/").httpOnly(true).sameSite("Strict")
        if (remember) c.maxAge(Duration.ofDays(30))
        res.addHeader(HttpHeaders.SET_COOKIE, c.build().toString())
    }

    private static Map<String, Object> userJson(AppUser u) {
        [id: u.id, name: u.name, email: u.email, admin: u.admin == true, createdAt: u.createdAt?.toString()] as Map<String, Object>
    }
}
