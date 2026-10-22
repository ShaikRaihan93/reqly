package com.reqly.security

import com.reqly.entity.AppUser
import org.springframework.web.context.request.RequestAttributes
import org.springframework.web.context.request.RequestContextHolder

/** The signed-in user of the current HTTP request (set by {@link SecurityFilter}). */
class CurrentUser {

    static final String ATTRIBUTE = "reqly.currentUser"

    static AppUser get() {
        def user = RequestContextHolder.getRequestAttributes()?.getAttribute(ATTRIBUTE, RequestAttributes.SCOPE_REQUEST) as AppUser
        if (user == null) throw new IllegalStateException("Not signed in")
        user
    }

    static Long id() { get().id }
}
