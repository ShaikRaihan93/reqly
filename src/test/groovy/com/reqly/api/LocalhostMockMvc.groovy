package com.reqly.api

import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcBuilderCustomizer
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get

/** Browsers always send a Host header; MockMvc doesn't, and the security filter (rightly) rejects that. */
@TestConfiguration
class LocalhostMockMvc {
    @Bean
    MockMvcBuilderCustomizer localhostHost() {
        { builder -> builder.defaultRequest(get("/").header("Host", "localhost")) } as MockMvcBuilderCustomizer
    }
}
