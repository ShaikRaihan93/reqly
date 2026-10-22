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
    Long collectionId
    Long environmentId
}
