package com.reqly

import org.junit.jupiter.api.Test

import static org.junit.jupiter.api.Assertions.*

/** Every version bump must come with a CHANGELOG entry (./gradlew bumpVersion writes both). */
class VersionTest {

    @Test
    void changelogHasAnEntryForTheCurrentVersion() {
        def props = new Properties()
        new File('gradle.properties').withInputStream { props.load(it) }
        def version = props.getProperty('version')
        assertTrue(version ==~ /\d+\.\d+\.\d+/, "version must be major.minor.patch, got ${version}")
        def entries = new File('CHANGELOG.md').text =~ /(?m)^## \[([^\]]+)\]/
        def top = entries.find() ? entries.group(1) : null
        assertEquals(version, top, 'the newest CHANGELOG entry must be for the version in gradle.properties')
    }
}
