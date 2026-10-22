package com.reqly.controller

import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.info.BuildProperties
import org.springframework.web.bind.annotation.ControllerAdvice
import org.springframework.web.bind.annotation.ModelAttribute

/** Gives every page the version from the build (gradle.properties), so it is never typed into a template. */
@ControllerAdvice(assignableTypes = PageController)
class VersionAdvice {

    private final String version

    VersionAdvice(ObjectProvider<BuildProperties> build) {
        this.version = build.getIfAvailable()?.version ?: 'dev'
    }

    @ModelAttribute("appVersion")
    String appVersion() { version }
}
