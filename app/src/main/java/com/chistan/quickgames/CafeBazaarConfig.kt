package com.chistan.quickgames

/**
 * Configuration parameters for CafeBazaar In-App Billing (Poolakey).
 * Application: com.chistan.quickgames (چیستان)
 *
 * Fair economy: 1 coin = 50 toman, no bonus coins, no discounts.
 * All coin packs are consumable, remove_ads is non-consumable.
 */
object CafeBazaarConfig {
    const val APP_ID = "com.chistan.quickgames"

    const val CAFEBAZAAR_PUBLIC_KEY = "MIHNMA0GCSqGSIb3DQEBAQUAA4G7ADCBtwKBrwCisMYaxsGwUIp+gtmYcbD1ihXL2RDHiBZ+cOryrNSm3P0ZWOo940sAHt4u0rpnczII9skRyNLUu0ej3I7bg4LqZxbSqQlI4jwWIa2sifCCOlmAidv6glbvXi1K6qugBog4wSyvRzbFgD56NYjobIPU+QmY7zyfAjGKM4KZvGbCVo7FcSLrYPFwQayDBngEsDTD1f6nrK3XHPovAX6cdnDp+k1UQBpm8A1IIL2+xAMCAwEAAQ=="

    // ---- Legacy labzband SKUs (kept for restore) ----
    const val SKU_COIN_PACK_250   = "coin_pack_250"
    const val SKU_COIN_PACK_750   = "coin_pack_750"
    const val SKU_COIN_PACK_2000  = "coin_pack_2000"
    const val SKU_COIN_PACK_5000  = "coin_pack_5000"
    const val SKU_COIN_PACK_10000 = "coin_pack_10000"
    const val SKU_COIN_PACK_25000 = "coin_pack_25000"

    // ---- Labzband fair packs (50 toman / coin) ----
    const val SKU_PACK_STARTER = "pack_starter"   // 200
    const val SKU_PACK_POPULAR = "pack_popular"   // 1000
    const val SKU_PACK_SUPER   = "pack_super"     // 2500
    const val SKU_PACK_ROYAL   = "pack_royal"     // 5000
    const val SKU_PACK_VAULT   = "pack_vault"     // 10000

    // ---- ChistanSara packs (چیستان‌سرا) - same 50 toman rate ----
    const val SKU_CHISTAN_200   = "chistan_pack_200"
    const val SKU_CHISTAN_500   = "chistan_pack_500"
    const val SKU_CHISTAN_1500  = "chistan_pack_1500"
    const val SKU_CHISTAN_4000  = "chistan_pack_4000"
    const val SKU_CHISTAN_10000 = "chistan_pack_10000"

    // ---- Jadooye Adad compatibility (used by math game) ----
    const val SKU_COINS_50   = "coins_50"
    const val SKU_COINS_150  = "coins_150"
    const val SKU_COINS_300  = "coins_300"
    const val SKU_COINS_600  = "coins_600"
    const val SKU_COINS_1200 = "coins_1200"
    const val SKU_COINS_2500 = "coins_2500"

    const val SKU_REMOVE_ADS = "remove_ads"

    val SUPPORTED_PRODUCTS: Set<String> = setOf(
        SKU_COIN_PACK_250,
        SKU_COIN_PACK_750,
        SKU_COIN_PACK_2000,
        SKU_COIN_PACK_5000,
        SKU_COIN_PACK_10000,
        SKU_COIN_PACK_25000,
        SKU_PACK_STARTER,
        SKU_PACK_POPULAR,
        SKU_PACK_SUPER,
        SKU_PACK_ROYAL,
        SKU_PACK_VAULT,
        SKU_CHISTAN_200,
        SKU_CHISTAN_500,
        SKU_CHISTAN_1500,
        SKU_CHISTAN_4000,
        SKU_CHISTAN_10000,
        SKU_COINS_50,
        SKU_COINS_150,
        SKU_COINS_300,
        SKU_COINS_600,
        SKU_COINS_1200,
        SKU_COINS_2500,
        SKU_REMOVE_ADS
    )

    fun isConsumable(sku: String): Boolean = SUPPORTED_PRODUCTS.contains(sku) && sku != SKU_REMOVE_ADS

    fun isNonConsumable(sku: String): Boolean = sku == SKU_REMOVE_ADS

    fun permanentUnlocks(productIds: Iterable<String>): Set<String> =
        productIds.filter { isNonConsumable(it) }.toSet()

    fun getCoinsForSku(sku: String): Int {
        return when (sku) {
            SKU_COIN_PACK_250   -> 250
            SKU_COIN_PACK_750   -> 750
            SKU_COIN_PACK_2000  -> 2000
            SKU_COIN_PACK_5000  -> 5000
            SKU_COIN_PACK_10000 -> 10000
            SKU_COIN_PACK_25000 -> 25000

            SKU_PACK_STARTER -> 200
            SKU_PACK_POPULAR -> 1000
            SKU_PACK_SUPER   -> 2500
            SKU_PACK_ROYAL   -> 5000
            SKU_PACK_VAULT   -> 10000

            SKU_CHISTAN_200   -> 200
            SKU_CHISTAN_500   -> 500
            SKU_CHISTAN_1500  -> 1500
            SKU_CHISTAN_4000  -> 4000
            SKU_CHISTAN_10000 -> 10000

            SKU_COINS_50   -> 50
            SKU_COINS_150  -> 150
            SKU_COINS_300  -> 300
            SKU_COINS_600  -> 600
            SKU_COINS_1200 -> 1200
            SKU_COINS_2500 -> 2500

            // chistan original ids (fallback)
            "pack_1" -> 500
            "pack_2" -> 1500
            "pack_3" -> 4000
            "pack_4" -> 10000

            else -> 100
        }
    }

    fun getPriceTomans(sku: String): Long {
        return when (sku) {
            SKU_COIN_PACK_250   -> 10000L
            SKU_COIN_PACK_750   -> 30000L
            SKU_COIN_PACK_2000  -> 70000L
            SKU_COIN_PACK_5000  -> 150000L
            SKU_COIN_PACK_10000 -> 250000L
            SKU_COIN_PACK_25000 -> 500000L
            SKU_REMOVE_ADS      -> 20000L
            else -> {
                val coins = getCoinsForSku(sku)
                coins * 50L
            }
        }
    }

    fun isSecurityCheckEnabled(): Boolean {
        return CAFEBAZAAR_PUBLIC_KEY.isNotBlank() && !CAFEBAZAAR_PUBLIC_KEY.startsWith("YOUR_")
    }
}
