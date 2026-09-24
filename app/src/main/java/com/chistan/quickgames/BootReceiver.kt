package com.chistan.quickgames

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Reschedules offline game notifications after device reboot.
 * WorkManager's periodic work should survive reboot automatically,
 * but this receiver ensures daily + inactivity checks are re-enqueued
 * as soon as BOOT_COMPLETED is received.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            intent.action != Intent.ACTION_PACKAGE_REPLACED) {
            return
        }
        try {
            Log.i(TAG, "Boot completed, rescheduling offline notifications")
            GameNotificationManager.createChannels(context)
            GameNotificationManager.scheduleDailyReminder(context)
            GameNotificationManager.scheduleInactivityCheck(context)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to reschedule after boot: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
