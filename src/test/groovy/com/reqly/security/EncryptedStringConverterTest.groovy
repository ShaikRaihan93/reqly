package com.reqly.security

import com.reqly.TestSupport
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test

import static org.junit.jupiter.api.Assertions.*

class EncryptedStringConverterTest {

    @BeforeAll
    static void setup() { TestSupport.init() }

    final c = new EncryptedStringConverter()

    @Test
    void roundTripsAndHidesThePlaintext() {
        def stored = c.convertToDatabaseColumn('{"apiKey":"s3cret"}')
        assertTrue(stored.startsWith("enc:v1:"))
        assertFalse(stored.contains("s3cret"))
        assertEquals('{"apiKey":"s3cret"}', c.convertToEntityAttribute(stored))
    }

    @Test
    void usesAFreshIvEveryTime() {
        assertNotEquals(c.convertToDatabaseColumn("same"), c.convertToDatabaseColumn("same"))
    }

    @Test
    void readsValuesStoredBeforeEncryptionExisted() {
        assertEquals('{"legacy":true}', c.convertToEntityAttribute('{"legacy":true}'))
        assertNull(c.convertToEntityAttribute(null))
    }

    @Test
    void rejectsTamperedCiphertext() {
        def stored = c.convertToDatabaseColumn("value")
        def tampered = stored.substring(0, stored.length() - 4) + (stored.endsWith("AAAA") ? "BBBB" : "AAAA")
        assertThrows(Exception) { c.convertToEntityAttribute(tampered) }
    }
}
