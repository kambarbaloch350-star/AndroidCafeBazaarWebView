package com.emochi.quickgames

/**
 * Configuration parameters for CafeBazaar In-App Billing (Poolakey).
 * Application: com.emochi.quickgames
 */
object CafeBazaarConfig {
    /**
     * The application package name registered in CafeBazaar.
     */
    const val APP_ID = "com.emochi.quickgames"

    /**
     * The RSA public key from your CafeBazaar Developer Console (https://pishkhan.cafebazaar.ir/).
     * Set this value for client-side cryptographic verification of purchase signatures.
     */
    const val CAFEBAZAAR_PUBLIC_KEY = ""

    /**
     * Official in-app coin pack SKUs configured in CafeBazaar console.
     * Prices are scaled 4x normal market rates.
     */
    const val SKU_COIN_PACK_250   = "coin_pack_250"
    const val SKU_COIN_PACK_750   = "coin_pack_750"
    const val SKU_COIN_PACK_2000  = "coin_pack_2000"
    const val SKU_COIN_PACK_5000  = "coin_pack_5000"
    const val SKU_COIN_PACK_10000 = "coin_pack_10000"
    const val SKU_COIN_PACK_25000 = "coin_pack_25000"

    /**
     * All supported in-app product identifiers.
     */
    val SUPPORTED_PRODUCTS: Set<String> = setOf(
        SKU_COIN_PACK_250,
        SKU_COIN_PACK_750,
        SKU_COIN_PACK_2000,
        SKU_COIN_PACK_5000,
        SKU_COIN_PACK_10000,
        SKU_COIN_PACK_25000
    )

    /**
     * Coin amounts awarded for each SKU.
     */
    fun getCoinsForSku(sku: String): Int {
        return when (sku) {
            SKU_COIN_PACK_250   -> 250
            SKU_COIN_PACK_750   -> 750
            SKU_COIN_PACK_2000  -> 2000
            SKU_COIN_PACK_5000  -> 5000
            SKU_COIN_PACK_10000 -> 10000
            SKU_COIN_PACK_25000 -> 25000
            else                -> 100
        }
    }

    /**
     * 4x Market prices in Tomans.
     */
    fun getPriceTomans(sku: String): Long {
        return when (sku) {
            SKU_COIN_PACK_250   -> 20000L   // 4x base (5,000 -> 20,000)
            SKU_COIN_PACK_750   -> 60000L   // 4x base (15,000 -> 60,000)
            SKU_COIN_PACK_2000  -> 140000L  // 4x base (35,000 -> 140,000)
            SKU_COIN_PACK_5000  -> 300000L  // 4x base (75,000 -> 300,000)
            SKU_COIN_PACK_10000 -> 500000L // 4x base (125,000 -> 500,000)
            SKU_COIN_PACK_25000 -> 1000000L // 4x base (250,000 -> 1,000,000)
            else                -> 20000L
        }
    }

    fun isSecurityCheckEnabled(): Boolean {
        return CAFEBAZAAR_PUBLIC_KEY.isNotBlank() && !CAFEBAZAAR_PUBLIC_KEY.startsWith("YOUR_")
    }
}
