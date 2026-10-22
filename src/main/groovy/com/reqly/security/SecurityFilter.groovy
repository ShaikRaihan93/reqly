package com.reqly.security

import com.reqly.service.AuthService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/**
 * Reqly runs on the user's machine, so the threats are other websites in the same browser and other
 * devices on the network. Every request is checked for:
 *  1. Host: only localhost names (blocks DNS-rebinding attacks)
 *  2. Origin: state-changing requests must come from Reqly itself (blocks cross-site requests)
 *  3. Sign-in: everything except the login page, legal pages and static assets needs a session
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class SecurityFilter extends OncePerRequestFilter {

    static final String COOKIE = "reqly_session"
    private static final Set<String> LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"] as Set
    private static final List<String> PUBLIC_PREFIXES = ["/login", "/privacy", "/terms", "/licenses", "/api/auth/", "/css/", "/js/", "/fonts/", "/img/", "/favicon", "/apple-touch-icon", "/error"]

    private final AuthService auth

    SecurityFilter(AuthService auth) {
        this.auth = auth
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) {
        if (!LOCAL_HOSTS.contains(hostOf(req.getHeader("Host")))) {
            res.sendError(403, "Reqly only accepts requests addressed to localhost")
            return
        }
        if (!(req.method in ["GET", "HEAD", "OPTIONS"]) && !sameOrigin(req)) {
            res.sendError(403, "Cross-site requests are not allowed")
            return
        }
        securityHeaders(res)

        def path = req.requestURI
        def user = auth.userForToken(cookie(req))
        if (user != null) req.setAttribute(CurrentUser.ATTRIBUTE, user)
        // The admin dashboard and its API are for admins only
        if (user != null && (path == "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/")) && user.admin != true) {
            if (path.startsWith("/api/")) {
                res.status = 403
                res.contentType = "application/json"
                res.writer.write('{"error":"Admins only"}')
            } else {
                res.sendRedirect("/")
            }
            return
        }
        if (user == null && !PUBLIC_PREFIXES.any { path == it || path.startsWith(it) }) {
            if (path.startsWith("/api/")) {
                res.status = 401
                res.contentType = "application/json"
                res.writer.write('{"error":"Please sign in"}')
            } else {
                res.sendRedirect("/login")
            }
            return
        }
        chain.doFilter(req, res)
    }

    static String cookie(HttpServletRequest req) {
        req.cookies?.find { it.name == COOKIE }?.value
    }

    private static String hostOf(String hostHeader) {
        if (!hostHeader) return ""
        def h = hostHeader.toLowerCase()
        if (h.startsWith("[")) return h.substring(0, h.indexOf("]") + 1)
        def colon = h.lastIndexOf(":")
        colon > 0 ? h.substring(0, colon) : h
    }

    /** Requests without an Origin (curl, the app itself on older browsers) are allowed; browsers always send one cross-site. */
    private static boolean sameOrigin(HttpServletRequest req) {
        def origin = req.getHeader("Origin")
        if (origin == null) return true
        if (origin == "null") return false // sandboxed frames and file:// pages
        try {
            def u = URI.create(origin)
            return LOCAL_HOSTS.contains(u.host?.toLowerCase()) && (u.port == -1 ? 80 : u.port) == req.serverPort
        } catch (ignored) {
            return false
        }
    }

    private static void securityHeaders(HttpServletResponse res) {
        res.setHeader("X-Content-Type-Options", "nosniff")
        res.setHeader("X-Frame-Options", "DENY")
        res.setHeader("Referrer-Policy", "no-referrer")
        // Scripts in requests are compiled at runtime inside a sandboxed frame, hence 'unsafe-eval'
        res.setHeader("Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self' blob: data:; " +
                "frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    }
}
