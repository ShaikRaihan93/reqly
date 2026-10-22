package com.reqly.controller

import com.reqly.security.SecurityFilter
import com.reqly.service.AuthService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping

@Controller
class PageController {

    private final AuthService auth

    PageController(AuthService auth) {
        this.auth = auth
    }

    @GetMapping("/")
    String index() {
        "index"
    }

    @GetMapping("/login")
    String login(HttpServletRequest req) {
        auth.userForToken(SecurityFilter.cookie(req)) ? "redirect:/" : "login"
    }

    @GetMapping("/privacy")
    String privacy() { "privacy" }

    @GetMapping("/terms")
    String terms() { "terms" }

    @GetMapping("/licenses")
    String licenses() { "licenses" }
}
