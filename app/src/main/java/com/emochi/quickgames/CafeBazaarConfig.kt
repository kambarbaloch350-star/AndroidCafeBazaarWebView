package com.emochi.quickgames

/**
 * CafeBazaar In-App Billing Configuration
 * Application: com.emochi.quickgames
 */
object CafeBazaarConfig {

    const val CAFEBAZAAR_PUBLIC_KEY = ""

    const val SKU_COIN_PACK_250 = "coin_pack_250"
    const val SKU_COIN_PACK_750 = "coin_pack_750"
    const val SKU_COIN_PACK_2000 = "coin_pack_2000"
    const val SKU_COIN_PACK_5000 = "coin_pack_5000"
    const val SKU_COIN_PACK_10000 = "coin_pack_10000"
    const val SKU_COIN_PACK_25000 = "coin_pack_25000"

    const val PRICE_MULTIPLIER = 4

    data class ProductInfo(
        val sku: String,
        val title: String,
        val coins: Int,
        val baseMarketPriceTomans: Long,
        val effectivePriceTomans: Long = baseMarketPriceTomans * PRICE_MULTIPLIER
    )

    val PRODUCTS = listOf(
        ProductInfo(SKU_COIN_PACK_250, "بسته ۲۵۰ سکه", 250, 5_000L),
        ProductInfo(SKU_COIN_PACK_750, "بسته ۷۵۰ سکه", 750, 15_000L),
        ProductInfo(SKU_COIN_PACK_2000, "بسته ۲,۰۰۰ سکه", 2000, 35_000L),
        ProductInfo(SKU_COIN_PACK_5000, "بسته ۵,۰۰۰ سکه", 5000, 75_000L),
        ProductInfo(SKU_COIN_PACK_10000, "بسته ۱۰,۰۰۰ سکه", 10000, 125_000L),
        ProductInfo(SKU_COIN_PACK_25000, "بسته ۲۵,۰۰۰ سکه مگا", 25000, 250_000L)
    )

    fun isSecurityCheckEnabled(): Boolean = CAFEBAZAAR_PUBLIC_KEY.isNotBlank()
}