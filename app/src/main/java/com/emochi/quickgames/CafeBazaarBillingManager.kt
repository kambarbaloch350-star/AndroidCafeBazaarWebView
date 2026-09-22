package com.emochi.quickgames

import android.app.Activity
import android.content.Context
import android.util.Log
import androidx.activity.ComponentActivity
import ir.cafebazaar.poolakey.Connection
import ir.cafebazaar.poolakey.Payment
import ir.cafebazaar.poolakey.config.PaymentConfiguration
import ir.cafebazaar.poolakey.config.SecurityCheck
import ir.cafebazaar.poolakey.entity.PurchaseInfo
import ir.cafebazaar.poolakey.request.PurchaseRequest
import java.lang.ref.WeakReference

/**
 * Manages CafeBazaar In-App Billing using Poolakey SDK.
 * Package: com.emochi.quickgames
 * Automatic token consumption is enabled for all coin packs.
 */
class CafeBazaarBillingManager(activity: ComponentActivity) {
    companion object {
        const val TAG = "CafeBazaarBilling"

        /** SharedPreferences file that mirrors the permanent unlocks. */
        private const val PREFS_NAME = "cafebazaar_billing"

        /** Key holding the owned non-consumable product IDs. */
        private const val KEY_OWNED_PRODUCTS = "owned_non_consumables"
    }

    private val activityRef = WeakReference(activity)
    private val appContext: Context = activity.applicationContext

    /**
     * Non-consumable products the user owns (`remove_ads`).
     *
     * Kept in memory **and** mirrored into `SharedPreferences` so the purchase
     * survives restarts and can gate interstitials even when CafeBazaar is
     * temporarily unreachable.
     */
    private val ownedProducts: MutableSet<String> = loadOwnedProducts()

    private var payment: Payment? = null
    private var paymentConnection: Connection? = null
    private var isConnected: Boolean = false

    interface BillingEventListener {
        fun onConnectionStatusChanged(result: ConnectionResult)
        fun onPurchaseResult(result: PurchaseResult)
        fun onConsumeResult(result: ConsumeResult)
        fun onPurchasesQueryResult(result: QueryPurchasesResult)

        /** Fired when the set of permanent (non-consumable) unlocks changes. */
        fun onOwnedProductsChanged(owned: Set<String>)
    }

    private var eventListener: BillingEventListener? = null

    init {
        initializePayment(activity)
    }

    fun setEventListener(listener: BillingEventListener?) {
        this.eventListener = listener
    }

    private fun initializePayment(activity: Activity) {
        try {
            val securityCheck = if (CafeBazaarConfig.isSecurityCheckEnabled()) {
                SecurityCheck.Enable(rsaPublicKey = CafeBazaarConfig.CAFEBAZAAR_PUBLIC_KEY)
            } else {
                SecurityCheck.Disable
            }
            val paymentConfig = PaymentConfiguration(localSecurityCheck = securityCheck)
            payment = Payment(context = activity.applicationContext, config = paymentConfig)
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing Poolakey Payment: ${e.message}", e)
        }
    }

    fun startConnection() {
        val paymentInstance = payment ?: run {
            notifyConnectionStatus(false, "Payment instance is null", "NOT_INITIALIZED")
            return
        }

        try {
            paymentConnection = paymentInstance.connect {
                connectionSucceed {
                    isConnected = true
                    notifyConnectionStatus(true, "Connected to CafeBazaar In-App Billing service")
                    // Automatically query active purchases to consume any pending unconsumed purchases
                    queryAndAutoConsumePurchases()
                }
                connectionFailed { throwable ->
                    isConnected = false
                    notifyConnectionStatus(
                        false,
                        throwable.message ?: "Failed to connect to CafeBazaar service",
                        "CONNECTION_FAILED"
                    )
                }
                disconnected {
                    isConnected = false
                    notifyConnectionStatus(false, "Disconnected from CafeBazaar service", "DISCONNECTED")
                }
            }
        } catch (e: Exception) {
            isConnected = false
            notifyConnectionStatus(false, "Exception during connection: ${e.message}", "EXCEPTION")
        }
    }

    fun isBillingAvailable(): Boolean = isConnected

    /** True when the user bought the permanent "remove ads" unlock. */
    fun isRemoveAdsOwned(): Boolean =
        safe(false) { ownedProducts.contains(CafeBazaarConfig.SKU_REMOVE_ADS) }

    /** Snapshot of every owned non-consumable product. */
    fun ownedNonConsumables(): Set<String> = safe(emptySet<String>()) { HashSet(ownedProducts) }

    private fun markOwned(productId: String) {
        if (!CafeBazaarConfig.isNonConsumable(productId)) return
        if (ownedProducts.add(productId)) persistOwnedProducts()
    }

    private fun syncOwnedProducts(purchased: List<String>) {
        val permanent = CafeBazaarConfig.permanentUnlocks(purchased)
        if (permanent != ownedProducts) {
            ownedProducts.clear()
            ownedProducts.addAll(permanent)
            persistOwnedProducts() // persists *and* notifies once
        }
    }

    private fun persistOwnedProducts() {
        runCatching {
            prefs().edit()
                .putStringSet(KEY_OWNED_PRODUCTS, HashSet(ownedProducts))
                .apply()
        }.onFailure { Log.w(TAG, "Could not persist owned products: ${it.message}") }
        notifyOwnedProductsChanged()
    }

    private fun loadOwnedProducts(): MutableSet<String> {
        val stored = runCatching {
            prefs().getStringSet(KEY_OWNED_PRODUCTS, emptySet()) ?: emptySet()
        }.getOrDefault(emptySet())
        return HashSet(stored)
    }

    private fun prefs() = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun notifyOwnedProductsChanged() {
        eventListener?.onOwnedProductsChanged(ownedNonConsumables())
    }

    private inline fun <T> safe(fallback: T, block: () -> T): T =
        try {
            block()
        } catch (e: Exception) {
            Log.w(TAG, "billing call failed: ${e.message}")
            fallback
        }

    fun purchase(productId: String, payload: String? = null) {
        val activity = activityRef.get() ?: run {
            notifyPurchaseResult(
                PurchaseResult(
                    success = false,
                    productId = productId,
                    message = "Activity is destroyed",
                    errorCode = "ACTIVITY_NULL"
                )
            )
            return
        }

        val paymentInstance = payment ?: run {
            notifyPurchaseResult(
                PurchaseResult(
                    success = false,
                    productId = productId,
                    message = "Payment client not initialized",
                    errorCode = "NOT_INITIALIZED"
                )
            )
            return
        }

        if (!isConnected) {
            notifyPurchaseResult(
                PurchaseResult(
                    success = false,
                    productId = productId,
                    message = "Billing service is not connected",
                    errorCode = "NOT_CONNECTED"
                )
            )
            return
        }

        try {
            val purchaseRequest = PurchaseRequest(
                productId = productId,
                payload = payload ?: "order_${System.currentTimeMillis()}"
            )
            paymentInstance.purchaseProduct(
                registry = activity.activityResultRegistry,
                request = purchaseRequest
            ) {
                purchaseFlowBegan {
                    // Purchase dialog launched successfully
                }
                failedToBeginFlow { throwable ->
                    notifyPurchaseResult(
                        PurchaseResult(
                            success = false,
                            productId = productId,
                            message = throwable.message ?: "Failed to start purchase flow",
                            errorCode = "FLOW_START_FAILED"
                        )
                    )
                }
                purchaseSucceed { purchaseInfo ->
                    // Permanent unlocks are remembered locally so interstitials
                    // stay off even before the next store query.
                    markOwned(purchaseInfo.productId)
                    // Purchase succeeded: Notify web layer
                    notifyPurchaseResult(
                        PurchaseResult(
                            success = true,
                            productId = purchaseInfo.productId,
                            purchaseToken = purchaseInfo.purchaseToken,
                            orderId = purchaseInfo.orderId,
                            purchaseTime = purchaseInfo.purchaseTime,
                            payload = purchaseInfo.payload,
                            message = "Purchase completed successfully"
                        )
                    )
                    // Auto-consume consumable coin packs so the user does not
                    // have to manage tokens; permanent unlocks (remove_ads) are
                    // deliberately left in the purchase list.
                    if (CafeBazaarConfig.isConsumable(purchaseInfo.productId)) {
                        consumePurchase(purchaseInfo.purchaseToken)
                    }
                }
                purchaseCanceled {
                    notifyPurchaseResult(
                        PurchaseResult(
                            success = false,
                            productId = productId,
                            message = "Purchase was canceled by the user",
                            errorCode = "USER_CANCELED"
                        )
                    )
                }
                purchaseFailed { throwable ->
                    notifyPurchaseResult(
                        PurchaseResult(
                            success = false,
                            productId = productId,
                            message = throwable.message ?: "Purchase transaction failed",
                            errorCode = "PURCHASE_FAILED"
                        )
                    )
                }
            }
        } catch (e: Exception) {
            notifyPurchaseResult(
                PurchaseResult(
                    success = false,
                    productId = productId,
                    message = "Exception during purchase: ${e.message}",
                    errorCode = "EXCEPTION"
                )
            )
        }
    }

    fun consumePurchase(purchaseToken: String) {
        val paymentInstance = payment ?: run {
            notifyConsumeResult(ConsumeResult(false, purchaseToken, "Payment not initialized", "NOT_INITIALIZED"))
            return
        }

        if (!isConnected) {
            notifyConsumeResult(ConsumeResult(false, purchaseToken, "Billing service not connected", "NOT_CONNECTED"))
            return
        }

        try {
            paymentInstance.consumeProduct(purchaseToken) {
                consumeSucceed {
                    notifyConsumeResult(ConsumeResult(true, purchaseToken, "Token consumed successfully"))
                }
                consumeFailed { throwable ->
                    notifyConsumeResult(
                        ConsumeResult(
                            false,
                            purchaseToken,
                            throwable.message ?: "Failed to consume token",
                            "CONSUME_FAILED"
                        )
                    )
                }
            }
        } catch (e: Exception) {
            notifyConsumeResult(
                ConsumeResult(false, purchaseToken, "Exception during consume: ${e.message}", "EXCEPTION")
            )
        }
    }

    fun queryPurchases() {
        val paymentInstance = payment ?: run {
            notifyPurchasesQueryResult(QueryPurchasesResult(false, emptyList(), "Payment not initialized", "NOT_INITIALIZED"))
            return
        }

        if (!isConnected) {
            notifyPurchasesQueryResult(QueryPurchasesResult(false, emptyList(), "Billing not connected", "NOT_CONNECTED"))
            return
        }

        try {
            paymentInstance.getPurchasedProducts {
                querySucceed { purchases: List<PurchaseInfo> ->
                    syncOwnedProducts(purchases.map { it.productId })
                    val resultList = purchases.map { p ->
                        PurchaseResult(
                            success = true,
                            productId = p.productId,
                            purchaseToken = p.purchaseToken,
                            orderId = p.orderId,
                            purchaseTime = p.purchaseTime,
                            payload = p.payload,
                            message = "Active purchase"
                        )
                    }
                    notifyPurchasesQueryResult(
                        QueryPurchasesResult(true, resultList, "Found ${resultList.size} purchased products")
                    )
                }
                queryFailed { throwable ->
                    notifyPurchasesQueryResult(
                        QueryPurchasesResult(
                            false,
                            emptyList(),
                            throwable.message ?: "Query failed",
                            "QUERY_FAILED"
                        )
                    )
                }
            }
        } catch (e: Exception) {
            notifyPurchasesQueryResult(
                QueryPurchasesResult(false, emptyList(), "Exception during query: ${e.message}", "EXCEPTION")
            )
        }
    }

    private fun queryAndAutoConsumePurchases() {
        payment?.getPurchasedProducts {
            querySucceed { purchases ->
                syncOwnedProducts(purchases.map { it.productId })
                for (p in purchases) {
                    if (CafeBazaarConfig.isConsumable(p.productId)) {
                        consumePurchase(p.purchaseToken)
                    }
                }
            }
        }
    }

    private fun notifyConnectionStatus(success: Boolean, message: String, errorCode: String? = null) {
        eventListener?.onConnectionStatusChanged(ConnectionResult(success, message, errorCode))
    }

    private fun notifyPurchaseResult(result: PurchaseResult) {
        eventListener?.onPurchaseResult(result)
    }

    private fun notifyConsumeResult(result: ConsumeResult) {
        eventListener?.onConsumeResult(result)
    }

    private fun notifyPurchasesQueryResult(result: QueryPurchasesResult) {
        eventListener?.onPurchasesQueryResult(result)
    }

    fun destroy() {
        try {
            paymentConnection?.disconnect()
            paymentConnection = null
            isConnected = false
        } catch (e: Exception) {
            Log.e(TAG, "Error disconnecting Poolakey: ${e.message}")
        }
    }
}
