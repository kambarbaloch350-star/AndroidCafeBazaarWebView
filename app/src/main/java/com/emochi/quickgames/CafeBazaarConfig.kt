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
    const val CAFEBAZAAR_PUBLIC_KEY = "MIHNMA0GCSqGSIb3DQEBAQUAA4G7ADCBtwKBrwCqG/cZk+gFYsstZCTOrms/8FnqyIpSWhOklqihA2byrtlDrNlPXSMp4ITAAODxe2+P3nCCDGFgsgFDcgXDoBP8+ePi3r4SHvuWSgLh0yh5cnR/g6nvevYZCV38BNxbSmk7uQe2rnq+GLA4XNyUEq25ctPbzsxjnyizxuX4pUnDcgyyxR6xVJahpeg6szoNYJw4iXDEL9Y94Ex14t3QKorwVrVoQlWTQUHczUlvwysCAwEAAQ=="

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
     * One-time (non-consumable) purchase that removes interstitial ads from the
     * game. Poolakey keeps it in the active purchase list, so the game only has
     * to call `CafeBazaar.getPurchases()` to know whether ads are disabled.
     */
    const val SKU_REMOVE_ADS = "remove_ads"

    /**
     * All supported in-app product identifiers.
     */
    val SUPPORTED_PRODUCTS: Set<String> = setOf(
        SKU_COIN_PACK_250,
        SKU_COIN_PACK_750,
        SKU_COIN_PACK_2000,
        SKU_COIN_PACK_5000,
        SKU_COIN_PACK_10000,
        SKU_COIN_PACK_25000,
        SKU_REMOVE_ADS
    )

    /** True when the SKU is consumed after purchase (coin packs). */
    fun isConsumable(sku: String): Boolean = sku.startsWith("coin_pack_")

    /** True when the SKU unlocks a permanent feature (remove ads). */
    fun isNonConsumable(sku: String): Boolean = sku == SKU_REMOVE_ADS

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
     * Reference prices in Tomans (2x the base rate).
     *
     * The authoritative price is always the one returned by CafeBazaar during the
     * purchase flow; this table only exists so the container can advertise an
     * expected value when the store is unreachable.
     */
    fun getPriceTomans(sku: String): Long {
        return when (sku) {
            SKU_COIN_PACK_250   -> 10000L     // 2x base (5,000 -> 10,000)
            SKU_COIN_PACK_750   -> 30000L     // 2x base (15,000 -> 30,000)
            SKU_COIN_PACK_2000  -> 70000L     // 2x base (35,000 -> 70,000)
            SKU_COIN_PACK_5000  -> 150000L    // 2x base (75,000 -> 150,000)
            SKU_COIN_PACK_10000 -> 250000L    // 2x base (125,000 -> 250,000)
            SKU_COIN_PACK_25000 -> 500000L    // 2x base (250,000 -> 500,000)
            SKU_REMOVE_ADS      -> 49000L
            else                -> 10000L
        }
    }

    fun isSecurityCheckEnabled(): Boolean {
        return CAFEBAZAAR_PUBLIC_KEY.isNotBlank() && !CAFEBAZAAR_PUBLIC_KEY.startsWith("YOUR_")
    }
}
