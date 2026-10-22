package com.reqly.service

import com.reqly.dto.RequestDto
import org.springframework.stereotype.Service

import java.util.regex.Pattern

@Service
class CurlParser {

    RequestDto parse(String curl) {
        def cmd = curl.trim()
        if (cmd.startsWith("curl")) {
            cmd = cmd.substring(4).trim()
        }

        def dto = new RequestDto(
            method: "GET",
            headers: [:] as LinkedHashMap,
            params: [:] as LinkedHashMap
        )

        def tokens = tokenize(cmd)

        for (int i = 0; i < tokens.size(); i++) {
            def token = tokens[i]

            switch (token) {
                case "-X":
                case "--request":
                    if (i + 1 < tokens.size()) dto.method = ReqlyService.normalizeMethod(tokens[++i])
                    break
                case "-H":
                case "--header":
                    if (i + 1 < tokens.size()) {
                        def header = tokens[++i]
                        def colonIdx = header.indexOf(':')
                        if (colonIdx > 0) {
                            def key = header.substring(0, colonIdx).trim()
                            def value = header.substring(colonIdx + 1).trim()
                            dto.headers[key] = value

                            if (key.equalsIgnoreCase("Authorization")) {
                                parseAuth(dto, value)
                            }
                        }
                    }
                    break
                case "-d":
                case "--data":
                case "--data-raw":
                case "--data-binary":
                    if (i + 1 < tokens.size()) {
                        dto.body = tokens[++i]
                        dto.bodyType = "raw"
                        if (dto.method == "GET") dto.method = "POST"
                    }
                    break
                case "--data-urlencode":
                    if (i + 1 < tokens.size()) {
                        dto.body = tokens[++i]
                        dto.bodyType = "x-www-form-urlencoded"
                        if (dto.method == "GET") dto.method = "POST"
                    }
                    break
                case "-u":
                case "--user":
                    if (i + 1 < tokens.size()) {
                        def creds = tokens[++i]
                        dto.authType = "basic"
                        def parts = creds.split(":", 2)
                        dto.authConfig = [
                            username: parts[0],
                            password: parts.length > 1 ? parts[1] : ""
                        ] as LinkedHashMap
                    }
                    break
                case "-k":
                case "--insecure":
                    dto.headers["_insecure"] = "true"
                    break
                case "-L":
                case "--location":
                case "--compressed":
                    break // handled by default
                default:
                    if (!token.startsWith("-") && dto.url == null) {
                        dto.url = token
                    }
            }
        }

        if (dto.url?.contains("?")) {
            def urlParts = dto.url.split("\\?", 2)
            dto.url = urlParts[0]
            if (urlParts.length > 1) {
                urlParts[1].split("&").each { param ->
                    // Values are stored decoded; the executor encodes them when sending
                    def kv = param.split("=", 2)
                    def dec = { String s -> try { URLDecoder.decode(s, "UTF-8") } catch (IllegalArgumentException ignored) { s } }
                    if (kv[0]) dto.params[dec(kv[0])] = kv.length > 1 ? dec(kv[1]) : ""
                }
            }
        }

        dto
    }

    private void parseAuth(RequestDto dto, String authHeader) {
        if (authHeader.toLowerCase().startsWith("bearer ")) {
            dto.authType = "bearer"
            dto.authConfig = [token: authHeader.substring(7).trim()] as LinkedHashMap
        } else if (authHeader.toLowerCase().startsWith("basic ")) {
            dto.authType = "basic"
            try {
                def decoded = new String(Base64.decoder.decode(authHeader.substring(6).trim()))
                def parts = decoded.split(":", 2)
                dto.authConfig = [
                    username: parts[0],
                    password: parts.length > 1 ? parts[1] : ""
                ] as LinkedHashMap
            } catch (ignored) {}
        }
    }

    private List<String> tokenize(String input) {
        def tokens = []
        def pattern = Pattern.compile("'([^']*)'|\"([^\"]*)\"|\\\\(.)|([^\\s]+)")
        input = input.replaceAll("\\\\\\s*\\n\\s*", " ")
        def matcher = pattern.matcher(input)
        while (matcher.find()) {
            if (matcher.group(1) != null) tokens << matcher.group(1)
            else if (matcher.group(2) != null) tokens << matcher.group(2)
            else if (matcher.group(3) != null) tokens << matcher.group(3)
            else if (matcher.group(4) != null) tokens << matcher.group(4)
        }
        tokens
    }
}
