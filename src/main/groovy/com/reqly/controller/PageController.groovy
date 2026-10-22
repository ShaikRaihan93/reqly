package com.reqly.controller

import com.reqly.security.CurrentUser
import com.reqly.security.SecurityFilter
import com.reqly.service.AuthService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping

@Controller
class PageController {

    private final AuthService auth

    PageController(AuthService auth) {
        this.auth = auth
    }

    /** The page carries the user's id so browser storage can be kept apart per account before any API call. */
    @GetMapping("/")
    String index(Model model) {
        model.addAttribute("userId", CurrentUser.id())
        "index"
    }

    @GetMapping("/login")
    String login(HttpServletRequest req) {
        auth.userForToken(SecurityFilter.cookie(req)) ? "redirect:/" : "login"
    }

    @GetMapping("/admin")
    String admin(Model model) {
        model.addAttribute("userId", CurrentUser.id())
        "admin"
    }

    @GetMapping("/privacy")
    String privacy() { "privacy" }

    @GetMapping("/terms")
    String terms() { "terms" }

    @GetMapping("/licenses")
    String licenses() { "licenses" }
}
