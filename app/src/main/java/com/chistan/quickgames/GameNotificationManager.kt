package com.chistan.quickgames

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.*
import java.util.Calendar
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * Offline Notification System for چیستان
 * ======================================
 * - Daily reminder: every day at 10 AM shows "بیا سکه های رایگانتو بگیر"
 * - Inactivity: if user hasn't opened app for 3 days, shows fun re-engagement messages
 * - Fun random notifications: variety of Persian messages
 *
 * 100% native, no server required, uses WorkManager for reliable scheduling.
 */
object GameNotificationManager {

    private const val TAG = "GameNotif"
    private const val PREFS_NAME = "chistan_notifications"
    private const val KEY_LAST_OPEN = "last_open_time"
    private const val KEY_DAILY_SCHEDULED = "daily_scheduled"

    const val CHANNEL_DAILY = "chistan_daily"
    const val CHANNEL_REENGAGE = "chistan_reengage"
    const val CHANNEL_FUN = "chistan_fun"

    // Daily messages – fun, encouraging
    private val dailyMessages = listOf(
        "بیا سکه های رایگانتو بگیر! 🎁" to "گردونه شانس و پاداش روزانه منتظرته! امروز رو از دست نده.",
        "چیستان امروز منتظرته! 🧠" to "۱۳۴۷ چیستان جذاب داریم، بیا ببین چندتاشو میتونی حل کنی!",
        "سکه های رایگان امروزت آماده است! 💰" to "وارد بازی شو و جایزه روزانه‌ات رو بگیر.",
        "مغزت رو گرم کن! 🔥" to "یک چیستان جدید حل کن و سکه جایزه بگیر.",
        "گردونه شانس امروز رو چرخوندی؟ 🎡" to "۳ شانس رایگان داری، با دیدن تبلیغ میتونی بچرخونی!",
        "زنجیره‌ات رو حفظ کن! ⛓️" to "با حل چیستان‌های بیشتر، سکه بونوس بگیر.",
        "چالش امروز: یک چیستان سخت! 🎯" to "بیا ببین میتونی این چیستان رو حل کنی؟",
        "سکه‌هات کم شده؟ 😊" to "ویدیوی جایزه‌دار ببین و ۱۵۰ سکه رایگان بگیر!"
    )

    // Inactivity messages – after 3 days not opening
    private val inactivityMessages = listOf(
        "خیلی وقته پیدا نیست بیا چیستان بگم حالت خوش شه! 🥺" to "دلتنگت شدیم! بیا یه چیستان باحال برات دارم.",
        "کجایی؟ چیستان‌ها دلتنگت شدن! 😢" to "۳ روزه نیومدی، بیا ببین چه چیستان‌های جدیدی داریم.",
        "مغزت زنگ زده؟ بیا یه چیستان حل کن! 🧩" to "خیلی وقته بازی نکردی، بیا دوباره شروع کن.",
        "سکه‌هات منتظرتن! 💎" to "۳ روزه سکه رایگانت رو نگرفتی، بیا بگیرش!",
        "یه چیستان باحال برات دارم! 😍" to "خیلی وقته ندیدمت، بیا یه چیستان بگم بخندیم!",
        "دلم برات تنگ شده! بیا بازی کنیم! 🎮" to "چیستان‌های جدید منتظرتن، بیا ببین میتونی حلشون کنی؟",
        "فراموشم کردی؟ 🥹" to "بیا یه چیستان بگم حالت جا بیاد!",
        "چالش جدید: میتونی اینو حل کنی؟ 🤔" to "آن چیست که هر چه بیشتر ببخشی بیشتر میشود؟ بیا جوابش رو پیدا کن!"
    )

    // Fun random messages
    private val funMessages = listOf(
        "میدونستی؟ 🤓" to "حل چیستان باعث تقویت حافظه و تمرکز میشه!",
        "یه چیستان باحال! 😎" to "آن چیست که بدون بال پرواز میکند؟ بیا جوابش رو پیدا کن!",
        "رکورد جدید بزن! 🏆" to "بهترین زنجیره‌ات رو بشکن و سکه بیشتر بگیر!",
        "چیستان‌دوستان منتظرتن! 👥" to "بهترین چیستان‌گو بشو!",
        "ذهنت رو به چالش بکش! 💡" to "چیستان‌های سخت منتظر آدمای باهوشه!",
        "سکه جمع کن، بسته بخر! 🛍️" to "با سکه‌هات میتونی بسته‌های ویژه بخری.",
        "امروز روز شانسته! 🍀" to "گردونه شانس رو بچرخون و جایزه بگیر!"
    )

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

        val channels = listOf(
            NotificationChannel(CHANNEL_DAILY, "یادآور روزانه", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "یادآوری روزانه برای دریافت سکه و چیستان"
                enableVibration(true)
                setShowBadge(true)
            },
            NotificationChannel(CHANNEL_REENGAGE, "بازگشت به بازی", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "اعلان برای کاربرانی که چند روز بازی نکردند"
                enableVibration(true)
                setShowBadge(true)
            },
            NotificationChannel(CHANNEL_FUN, "پیام‌های بامزه", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "پیام‌های سرگرم‌کننده و آموزشی"
                enableVibration(false)
                setShowBadge(false)
            }
        )
        channels.forEach { channel ->
            if (manager.getNotificationChannel(channel.id) == null) {
                manager.createNotificationChannel(channel)
            }
        }
    }

    fun updateLastOpenTime(context: Context) {
        val prefs = getPrefs(context)
        prefs.edit().putLong(KEY_LAST_OPEN, System.currentTimeMillis()).apply()
        Log.d(TAG, "Last open time updated")
    }

    fun getLastOpenTime(context: Context): Long {
        return getPrefs(context).getLong(KEY_LAST_OPEN, System.currentTimeMillis())
    }

    fun getDaysSinceLastOpen(context: Context): Int {
        val lastOpen = getLastOpenTime(context)
        val diff = System.currentTimeMillis() - lastOpen
        return (diff / (1000 * 60 * 60 * 24)).toInt()
    }

    fun scheduleDailyReminder(context: Context) {
        createChannels(context)
        val prefs = getPrefs(context)
        // Avoid rescheduling too often, but always ensure scheduled
        val workManager = WorkManager.getInstance(context)

        // Cancel existing and schedule new
        workManager.cancelUniqueWork("daily_reminder")

        // Calculate initial delay until next 10 AM
        val now = Calendar.getInstance()
        val next10am = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 10)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (before(now)) {
                add(Calendar.DAY_OF_YEAR, 1)
            }
        }
        val initialDelay = next10am.timeInMillis - now.timeInMillis

        val dailyRequest = PeriodicWorkRequestBuilder<DailyReminderWorker>(24, TimeUnit.HOURS)
            .setInitialDelay(initialDelay, TimeUnit.MILLISECONDS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                    .build()
            )
            .build()

        workManager.enqueueUniquePeriodicWork(
            "daily_reminder",
            ExistingPeriodicWorkPolicy.UPDATE,
            dailyRequest
        )
        prefs.edit().putBoolean(KEY_DAILY_SCHEDULED, true).apply()
        Log.i(TAG, "Daily reminder scheduled, initial delay: ${initialDelay / 1000 / 60} minutes")
    }

    fun scheduleInactivityCheck(context: Context) {
        val workManager = WorkManager.getInstance(context)
        workManager.cancelUniqueWork("inactivity_check")

        val inactivityRequest = PeriodicWorkRequestBuilder<InactivityWorker>(24, TimeUnit.HOURS)
            .setInitialDelay(3, TimeUnit.HOURS) // First check after 3 hours
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                    .build()
            )
            .build()

        workManager.enqueueUniquePeriodicWork(
            "inactivity_check",
            ExistingPeriodicWorkPolicy.UPDATE,
            inactivityRequest
        )
        Log.i(TAG, "Inactivity check scheduled")
    }

    fun scheduleFunNotification(context: Context) {
        val workManager = WorkManager.getInstance(context)
        // One-time work for fun notification after 6-12 hours
        val delayHours = Random.nextLong(6, 13)
        val funRequest = OneTimeWorkRequestBuilder<FunNotificationWorker>()
            .setInitialDelay(delayHours, TimeUnit.HOURS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                    .build()
            )
            .build()
        workManager.enqueue(funRequest)
    }

    fun showNotification(context: Context, title: String, message: String, channelId: String, notificationId: Int) {
        if (!PushfaManager.hasNotificationPermission(context)) {
            Log.d(TAG, "Notification permission not granted, skipping")
            return
        }
        try {
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                notificationId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val builder = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setColor(context.getColor(R.color.primary))

            val manager = NotificationManagerCompat.from(context)
            manager.notify(notificationId, builder.build())
            Log.i(TAG, "Notification shown: $title")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to show notification", e)
        }
    }

    fun getRandomDailyMessage(): Pair<String, String> {
        return dailyMessages.random()
    }

    fun getRandomInactivityMessage(): Pair<String, String> {
        return inactivityMessages.random()
    }

    fun getRandomFunMessage(): Pair<String, String> {
        return funMessages.random()
    }

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // Workers
    class DailyReminderWorker(appContext: Context, params: WorkerParameters) : Worker(appContext, params) {
        override fun doWork(): Result {
            return try {
                val (title, message) = getRandomDailyMessage()
                showNotification(applicationContext, title, message, CHANNEL_DAILY, 1001)
                // Schedule next fun notification
                scheduleFunNotification(applicationContext)
                Result.success()
            } catch (e: Exception) {
                Log.e(TAG, "Daily worker failed", e)
                Result.retry()
            }
        }
    }

    class InactivityWorker(appContext: Context, params: WorkerParameters) : Worker(appContext, params) {
        override fun doWork(): Result {
            return try {
                val days = getDaysSinceLastOpen(applicationContext)
                Log.d(TAG, "Inactivity check: $days days since last open")
                if (days >= 3) {
                    val (title, message) = getRandomInactivityMessage()
                    showNotification(applicationContext, title, message, CHANNEL_REENGAGE, 1002)
                }
                Result.success()
            } catch (e: Exception) {
                Log.e(TAG, "Inactivity worker failed", e)
                Result.retry()
            }
        }
    }

    class FunNotificationWorker(appContext: Context, params: WorkerParameters) : Worker(appContext, params) {
        override fun doWork(): Result {
            return try {
                // Only show fun notification if user hasn't opened app today
                val days = getDaysSinceLastOpen(applicationContext)
                if (days >= 1) {
                    val (title, message) = getRandomFunMessage()
                    showNotification(applicationContext, title, message, CHANNEL_FUN, 1003)
                }
                Result.success()
            } catch (e: Exception) {
                Log.e(TAG, "Fun worker failed", e)
                Result.retry()
            }
        }
    }
}
