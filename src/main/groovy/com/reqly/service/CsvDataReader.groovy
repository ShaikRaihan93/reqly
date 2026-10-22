package com.reqly.service

import com.opencsv.CSVReader
import org.springframework.stereotype.Service
import org.springframework.web.multipart.MultipartFile

@Service
class CsvDataReader {

    List<Map<String, String>> readFromFile(MultipartFile file) {
        new CSVReader(new InputStreamReader(file.inputStream)).withCloseable { reader ->
            parse(reader)
        }
    }

    List<Map<String, String>> readFromString(String csvContent) {
        new CSVReader(new StringReader(csvContent)).withCloseable { reader ->
            parse(reader)
        }
    }

    private List<Map<String, String>> parse(CSVReader reader) {
        def allRows = reader.readAll()
        if (allRows.isEmpty()) return []

        def headers = allRows[0]
        allRows.drop(1).collect { row ->
            def map = [:] as LinkedHashMap<String, String>
            headers.eachWithIndex { header, j ->
                map[header.trim()] = j < row.length ? row[j].trim() : ""
            }
            map
        }
    }
}
