package com.emochi.quickgames

import org.json.JSONArray
import org.json.JSONObject

/**
 * Encapsulates the result of a purchase operation sent back to JavaScript.
 */
data class PurchaseResult(
    val success: Boolean,
    val productId: String,
    val purchaseToken: String? = null,
    val orderId: String? = null,
    val purchaseTime: Long? = null,
    val payload: String? = null,
    val message: String,
    val errorCode: String? = null
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("success", success)
        json.put("productId", productId)
        purchaseToken?.let { json.put("purchaseToken", it) }
        orderId?.let { json.put("orderId", it) }
        purchaseTime?.let { json.put("purchaseTime", it) }
        payload?.let { json.put("payload", it) }
        json.put("message", message)
        errorCode?.let { json.put("errorCode", it) }
        return json
    }
}

/**
 * Encapsulates the result of a token consumption operation sent back to JavaScript.
 */
data class ConsumeResult(
    val success: Boolean,
    val purchaseToken: String,
    val message: String,
    val errorCode: String? = null
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("success", success)
        json.put("purchaseToken", purchaseToken)
        json.put("message", message)
        errorCode?.let { json.put("errorCode", it) }
        return json
    }
}

/**
 * Encapsulates the result of billing service connection status sent to JavaScript.
 */
data class ConnectionResult(
    val success: Boolean,
    val message: String,
    val errorCode: String? = null
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("success", success)
        json.put("message", message)
        errorCode?.let { json.put("errorCode", it) }
        return json
    }
}

/**
 * Encapsulates the result of querying active purchases from CafeBazaar.
 */
data class QueryPurchasesResult(
    val success: Boolean,
    val purchases: List<PurchaseResult>,
    val message: String,
    val errorCode: String? = null
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("success", success)
        json.put("message", message)
        errorCode?.let { json.put("errorCode", it) }
        val purchasesArray = JSONArray()
        for (item in purchases) {
            purchasesArray.put(item.toJson())
        }
        json.put("purchases", purchasesArray)
        return json
    }
}
