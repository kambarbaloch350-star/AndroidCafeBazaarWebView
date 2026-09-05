package com.emochi.quickgames

import android.app.Activity
import androidx.activity.ComponentActivity
import ir.cafebazaar.poolakey.Connection
import ir.cafebazaar.poolakey.Payment
import ir.cafebazaar.poolakey.config.PaymentConfiguration
import ir.cafebazaar.poolakey.config.SecurityCheck
import ir.cafebazaar.poolakey.entity.PurchaseInfo
import ir.cafebazaar.poolakey.request.PurchaseRequest
import java.lang.ref.WeakReference

class CafeBazaarBillingManager(activity: ComponentActivity) {
    private val activityRef = WeakReference(activity)
    private var payment: Payment? = null
    private var paymentConnection: Connection? = null
    private var isConnected: Boolean = false

    interface BillingEventListener {
        fun onConnectionStatusChanged(result: ConnectionResult)
        fun onPurchaseResult(result: PurchaseResult)
        fun onConsumeResult(result: ConsumeResult)
        fun onPurchasesQueryResult(result: QueryPurchasesResult)
    }

    private var eventListener: BillingEventListener? = null

    init {
        val paymentConfig = PaymentConfiguration(localSecurityCheck = SecurityCheck.Disable)
        payment = Payment(context = activity.applicationContext, config = paymentConfig)
    }

    fun setEventListener(listener: BillingEventListener?) {
        this.eventListener = listener
    }

    fun startConnection() {
        paymentConnection = payment?.connect {
            connectionSucceed {
                isConnected = true
                eventListener?.onConnectionStatusChanged(ConnectionResult(true, "Connected"))
            }
            connectionFailed { throwable ->
                isConnected = false
                eventListener?.onConnectionStatusChanged(ConnectionResult(false, throwable.message ?: "Failed"))
            }
            disconnected {
                isConnected = false
            }
        }
    }

    fun isBillingAvailable(): Boolean = isConnected

    fun purchase(productId: String, payload: String? = null) {
        val activity = activityRef.get() ?: return
        payment?.purchaseProduct(
            registry = activity.activityResultRegistry,
            request = PurchaseRequest(productId, payload ?: "order_${System.currentTimeMillis()}")
        ) {
            purchaseSucceed { info ->
                eventListener?.onPurchaseResult(
                    PurchaseResult(true, info.productId, info.purchaseToken, info.orderId, info.purchaseTime, info.payload, "Success")
                )
                // Auto-consume consumable coin packs
                if (info.productId.startsWith("coin_pack_")) {
                    consumePurchase(info.purchaseToken)
                }
            }
            purchaseCanceled {
                eventListener?.onPurchaseResult(PurchaseResult(false, productId, message = "Canceled by user"))
            }
            purchaseFailed { throwable ->
                eventListener?.onPurchaseResult(PurchaseResult(false, productId, message = throwable.message ?: "Failed"))
            }
        }
    }

    fun consumePurchase(purchaseToken: String) {
        payment?.consumeProduct(purchaseToken) {
            consumeSucceed {
                eventListener?.onConsumeResult(ConsumeResult(true, purchaseToken, "Consumed"))
            }
            consumeFailed { throwable ->
                eventListener?.onConsumeResult(ConsumeResult(false, purchaseToken, throwable.message ?: "Error"))
            }
        }
    }

    fun queryPurchases() {
        payment?.getPurchasedProducts {
            querySucceed { purchases ->
                val list = purchases.map { PurchaseResult(true, it.productId, it.purchaseToken, it.orderId, it.purchaseTime, it.payload) }
                eventListener?.onPurchasesQueryResult(QueryPurchasesResult(true, list))
            }
        }
    }

    fun destroy() {
        paymentConnection?.disconnect()
    }
}