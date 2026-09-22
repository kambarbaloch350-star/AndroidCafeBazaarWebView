package com.emochi.quickgames

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Rules that decide what a purchase does.
 *
 * `remove_ads` must stay a permanent unlock (it gates interstitials), every coin
 * pack must stay consumable (so it can be bought again), and the advertised
 * fallback prices must stay at 2x the base rate.
 */
class CafeBazaarConfigTest {

    @Test
    fun `coin packs are consumable and remove_ads is not`() {
        CafeBazaarConfig.SUPPORTED_PRODUCTS
            .filter { it.startsWith("coin_pack_") }
            .forEach { assertTrue("$it must be consumable", CafeBazaarConfig.isConsumable(it)) }

        assertTrue(CafeBazaarConfig.isNonConsumable(CafeBazaarConfig.SKU_REMOVE_ADS))
        assertFalse(CafeBazaarConfig.isConsumable(CafeBazaarConfig.SKU_REMOVE_ADS))
    }

    @Test
    fun `remove_ads is always part of the supported products`() {
        assertTrue(CafeBazaarConfig.SUPPORTED_PRODUCTS.contains(CafeBazaarConfig.SKU_REMOVE_ADS))
    }

    @Test
    fun `permanentUnlocks keeps only remove_ads`() {
        val unlocks = CafeBazaarConfig.permanentUnlocks(
            listOf(CafeBazaarConfig.SKU_COIN_PACK_250, CafeBazaarConfig.SKU_REMOVE_ADS)
        )
        assertEquals(setOf(CafeBazaarConfig.SKU_REMOVE_ADS), unlocks)
    }

    @Test
    fun `permanentUnlocks is empty for consumables only`() {
        assertTrue(
            CafeBazaarConfig.permanentUnlocks(
                listOf(CafeBazaarConfig.SKU_COIN_PACK_250, CafeBazaarConfig.SKU_COIN_PACK_25000)
            ).isEmpty()
        )
        assertTrue(CafeBazaarConfig.permanentUnlocks(emptyList()).isEmpty())
    }

    @Test
    fun `prices are doubled against the base rate`() {
        // base -> advertised 2x
        val expected = mapOf(
            CafeBazaarConfig.SKU_COIN_PACK_250 to 10_000L,
            CafeBazaarConfig.SKU_COIN_PACK_750 to 30_000L,
            CafeBazaarConfig.SKU_COIN_PACK_2000 to 70_000L,
            CafeBazaarConfig.SKU_COIN_PACK_5000 to 150_000L,
            CafeBazaarConfig.SKU_COIN_PACK_10000 to 250_000L,
            CafeBazaarConfig.SKU_COIN_PACK_25000 to 500_000L
        )
        expected.forEach { (sku, toman) ->
            assertEquals("price of $sku", toman, CafeBazaarConfig.getPriceTomans(sku))
        }
    }

    @Test
    fun `every coin pack maps to a positive coin amount`() {
        CafeBazaarConfig.SUPPORTED_PRODUCTS
            .filter { CafeBazaarConfig.isConsumable(it) }
            .forEach { assertTrue("$it awards coins", CafeBazaarConfig.getCoinsForSku(it) > 0) }
    }

    @Test
    fun `falls back gracefully for unknown skus`() {
        assertFalse(CafeBazaarConfig.isConsumable("mystery"))
        assertFalse(CafeBazaarConfig.isNonConsumable("mystery"))
    }
}
