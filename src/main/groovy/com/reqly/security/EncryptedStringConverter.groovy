package com.reqly.security

import jakarta.persistence.AttributeConverter
import jakarta.persistence.Converter

import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.attribute.PosixFilePermissions
import java.security.SecureRandom

/**
 * Encrypts sensitive columns (environment variables, auth settings, headers) with AES-256-GCM.
 * The key is generated on first use and stored next to the database in {@code reqly.key} (owner-only
 * permissions), so a copied database file alone doesn't reveal secrets.
 * Values written before encryption existed are read as-is and encrypted on their next save.
 */
@Converter
class EncryptedStringConverter implements AttributeConverter<String, String> {

    private static final String PREFIX = "enc:v1:"
    private static final int IV_BYTES = 12
    private static final SecureRandom RANDOM = new SecureRandom()
    private static volatile SecretKeySpec key

    @Override
    String convertToDatabaseColumn(String plain) {
        if (plain == null) return null
        byte[] iv = new byte[IV_BYTES]
        RANDOM.nextBytes(iv)
        def cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(128, iv))
        byte[] sealed = cipher.doFinal(plain.getBytes("UTF-8"))
        byte[] out = new byte[iv.length + sealed.length]
        System.arraycopy(iv, 0, out, 0, iv.length)
        System.arraycopy(sealed, 0, out, iv.length, sealed.length)
        PREFIX + Base64.encoder.encodeToString(out)
    }

    @Override
    String convertToEntityAttribute(String stored) {
        if (stored == null || !stored.startsWith(PREFIX)) return stored
        byte[] all = Base64.decoder.decode(stored.substring(PREFIX.length()))
        def cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, all, 0, IV_BYTES))
        new String(cipher.doFinal(all, IV_BYTES, all.length - IV_BYTES), "UTF-8")
    }

    static Path keyFile() {
        def dir = System.getProperty("reqly.data-dir") ?: Paths.get(System.getProperty("user.home"), "reqly-data").toString()
        Paths.get(dir, "reqly.key")
    }

    private static SecretKeySpec key() {
        if (key == null) {
            synchronized (EncryptedStringConverter) {
                if (key == null) key = new SecretKeySpec(loadOrCreate(keyFile()), "AES")
            }
        }
        key
    }

    private static byte[] loadOrCreate(Path file) {
        if (Files.exists(file)) return Base64.decoder.decode(Files.readString(file).trim())
        Files.createDirectories(file.parent)
        byte[] k = new byte[32]
        RANDOM.nextBytes(k)
        Files.writeString(file, Base64.encoder.encodeToString(k))
        try { Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------")) } catch (UnsupportedOperationException ignored) { /* Windows */ }
        k
    }
}
