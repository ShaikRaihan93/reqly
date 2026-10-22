package com.reqly.api

import com.reqly.TestSupport
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.web.servlet.MockMvc

import static org.junit.jupiter.api.Assertions.*
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@AutoConfigureMockMvc
@Import(LocalhostMockMvc)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PostmanRoundTripIntegrationTest {

    static { TestSupport.init() }

    @Autowired MockMvc mvc

    private Object call(def builder, Cookie user) {
        def r = mvc.perform(builder.cookie(user).contentType(MediaType.APPLICATION_JSON)).andExpect(status().isOk()).andReturn()
        new JsonSlurper().parseText(r.response.contentAsString)
    }

    @Test
    void exportThenImportKeepsParamsFormDataAndSettings() {
        def user = mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content(JsonOutput.toJson([name: "P", email: "postman@test.io", password: "correct-horse-1"])))
                .andExpect(status().isOk()).andReturn().response.getCookie("reqly_session")
        def col = call(post("/api/collections").content(JsonOutput.toJson([name: "Src"])), user)
        def rows = [[key: "id", value: "1", enabled: true], [key: "id", value: "2", enabled: true], [key: "off", value: "x", enabled: false]]
        def form = '[{"key":"note","value":"hi","type":"text","enabled":true},{"key":"upload","type":"file","enabled":true,"fileName":"a.txt"}]'
        call(post("/api/requests").content(JsonOutput.toJson([name: "R", method: "POST", url: "http://h/x", collectionId: col.id,
                paramRows: rows, params: [id: "2"], headers: [:], body: form, bodyType: "form-data",
                settings: [followRedirects: false, insecure: true]])), user)

        def exported = call(get("/api/collections/${col.id}/export"), user)
        exported.info.name = "Copy"
        def imported = call(post("/api/import/postman").content(JsonOutput.toJson(exported)), user)
        def tree = call(get("/api/tree"), user)
        def copyId = tree.collections.find { it.id == imported.collectionId }.requests[0].id
        def copy = call(get("/api/requests/${copyId}"), user)

        assertEquals(rows, copy.paramRows)
        assertEquals("form-data", copy.bodyType)
        assertEquals(new JsonSlurper().parseText(form), new JsonSlurper().parseText(copy.body))
        assertEquals([followRedirects: false, insecure: true], copy.settings)
    }
}
