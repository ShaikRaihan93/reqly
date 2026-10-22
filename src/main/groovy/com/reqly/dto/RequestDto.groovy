package com.reqly.dto

class RequestDto {
    Long id
    String name
    String method
    String url
    Map<String, String> headers
    Map<String, String> params
    Map<String, String> disabledHeaders
    Map<String, String> disabledParams
    String body
    String bodyType
    String authType
    Map<String, String> authConfig
    String testScript
    String preRequestScript
    /** Per-request options: timeoutMs, insecure (ignore SSL errors), followRedirects */
    Map<String, Object> settings
    Long collectionId
    Long environmentId
}
