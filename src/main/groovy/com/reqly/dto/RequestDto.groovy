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
    /** All query rows in order, duplicates allowed: [{key, value, enabled}]. Takes precedence over params. */
    List<Map<String, Object>> paramRows
    String body
    String bodyType
    String authType
    Map<String, String> authConfig
    String testScript
    /** JavaScript run in the browser before sending (Postman-style, with pm and console) */
    String preRequestScript
    /** JavaScript run in the browser after the response arrives */
    String postResponseScript
    /** Per-request options: timeoutMs, insecure (ignore SSL errors), followRedirects */
    Map<String, Object> settings
    Long collectionId
    Long environmentId
}
