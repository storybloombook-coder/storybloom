package com.storybloom.app.scene

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * One coarse location and one small Open-Meteo request are enough to restore
 * the predecessor's live-weather behavior. Failures deliberately resolve to
 * CLEAR so weather can never delay or block the scene.
 */
object SceneWeatherService {
    private val refreshMutex = Mutex()
    private var lastAttemptAtMs = 0L
    private var lastSuccessAtMs = 0L
    private var cachedWeather = SceneWeather.CLEAR
    private var cachedLatitude: Double? = null
    private var cachedLongitude: Double? = null

    fun hasLocationPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

    suspend fun refresh(context: Context): SceneWeatherObservation = refreshMutex.withLock {
        val now = System.currentTimeMillis()
        if (now - lastAttemptAtMs < MIN_REQUEST_GAP_MS) {
            return@withLock currentObservation(now)
        }
        lastAttemptAtMs = now
        if (!hasLocationPermission(context)) return@withLock currentObservation(now)

        val location = findCoarseLocation(context) ?: return@withLock currentObservation(now)
        cachedLatitude = location.latitude
        cachedLongitude = location.longitude
        val weather = fetchWeather(location) ?: return@withLock currentObservation(now)
        cachedWeather = weather
        lastSuccessAtMs = System.currentTimeMillis()
        currentObservation(lastSuccessAtMs)
    }

    private fun currentObservation(now: Long): SceneWeatherObservation =
        SceneWeatherObservation(
            weather = if (
                lastSuccessAtMs > 0L &&
                now - lastSuccessAtMs <= STALE_AFTER_MS
            ) {
                cachedWeather
            } else {
                SceneWeather.CLEAR
            },
            latitude = cachedLatitude,
            longitude = cachedLongitude,
        )

    private suspend fun findCoarseLocation(context: Context): Location? {
        if (
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return null
        }
        val manager = context.getSystemService(LocationManager::class.java) ?: return null
        val providers = runCatching { manager.getProviders(true) }.getOrDefault(emptyList())
        val last = providers
            .mapNotNull { provider ->
                runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
            }
            .maxByOrNull(Location::getTime)
        if (last != null) return last
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null

        val provider = when {
            providers.contains(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            providers.contains(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            else -> return null
        }
        return withTimeoutOrNull(LOCATION_TIMEOUT_MS) {
            suspendCancellableCoroutine { continuation ->
                val cancellation = CancellationSignal()
                continuation.invokeOnCancellation { cancellation.cancel() }
                try {
                    manager.getCurrentLocation(
                        provider,
                        cancellation,
                        context.mainExecutor,
                    ) { location ->
                        if (continuation.isActive) continuation.resume(location)
                    }
                } catch (_: SecurityException) {
                    if (continuation.isActive) continuation.resume(null)
                } catch (_: RuntimeException) {
                    if (continuation.isActive) continuation.resume(null)
                }
            }
        }
    }

    private suspend fun fetchWeather(location: Location): SceneWeather? =
        withContext(Dispatchers.IO) {
            val latitude = String.format(Locale.US, "%.3f", location.latitude)
            val longitude = String.format(Locale.US, "%.3f", location.longitude)
            val endpoint =
                "https://api.open-meteo.com/v1/forecast" +
                    "?latitude=$latitude&longitude=$longitude" +
                    "&current=weather_code,cloud_cover,is_day" +
                    "&daily=sunrise,sunset&timezone=auto"
            val connection = runCatching {
                URL(endpoint).openConnection() as HttpURLConnection
            }.getOrNull() ?: return@withContext null
            try {
                connection.requestMethod = "GET"
                connection.connectTimeout = NETWORK_TIMEOUT_MS
                connection.readTimeout = NETWORK_TIMEOUT_MS
                connection.setRequestProperty("Accept", "application/json")
                if (connection.responseCode !in 200..299) return@withContext null
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val code = JSONObject(body)
                    .optJSONObject("current")
                    ?.takeIf { it.has("weather_code") }
                    ?.optInt("weather_code")
                sceneWeatherForWmoCode(code)
            } catch (_: Exception) {
                null
            } finally {
                connection.disconnect()
            }
        }

    private const val MIN_REQUEST_GAP_MS = 5L * 60L * 1_000L
    private const val STALE_AFTER_MS = 3L * 60L * 60L * 1_000L
    private const val LOCATION_TIMEOUT_MS = 4_000L
    private const val NETWORK_TIMEOUT_MS = 5_000
}

data class SceneWeatherObservation(
    val weather: SceneWeather,
    val latitude: Double? = null,
    val longitude: Double? = null,
)
