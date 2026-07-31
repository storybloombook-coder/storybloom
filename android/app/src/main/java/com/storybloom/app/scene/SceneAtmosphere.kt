package com.storybloom.app.scene

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sin

/**
 * Time and weather are scene mechanics, not a background swap.
 *
 * The original scene continuously combined the local day phase with a
 * four-second weather transition. Keeping that combination in one native
 * director means clouds, precipitation, wetness, wind, fog and window light
 * all react to the same state instead of drifting apart.
 */
internal class SceneAtmosphereDirector(
    initialHour: Float = 12f,
) {
    private val weatherWeights = FloatArray(SceneWeather.entries.size)
    private var targetWeather = SceneWeather.CLEAR
    private var phasePalette = paletteForHour(initialHour)
    private var windClock = 0f
    private var windDirection = .64f
    private var stormWaitSeconds = 10f
    private var stormFlashSeconds = -1f
    private var stormSequence = 0
    private var latest = composeFrame(phasePalette, weatherWeights.also {
        it[SceneWeather.CLEAR.ordinal] = 1f
    })

    fun setWeather(weather: SceneWeather) {
        targetWeather = weather
    }

    fun advance(
        deltaSeconds: Float,
        localHour: Float,
        solarElevationDegrees: Float? = null,
        beforeSolarNoon: Boolean = localHour < 12f,
    ): SceneAtmosphereFrame {
        val delta = deltaSeconds.coerceIn(0f, .25f)

        val paletteTarget = solarElevationDegrees?.let { elevation ->
            paletteForSolarElevation(elevation, beforeSolarNoon)
        } ?: paletteForHour(localHour)
        val paletteBlend = 1f - exp(-delta * PHASE_LERP_RATE)
        phasePalette = phasePalette.lerp(paletteTarget, paletteBlend)

        val weatherStep = delta / WEATHER_TRANSITION_SECONDS
        weatherWeights.indices.forEach { index ->
            val target = if (index == targetWeather.ordinal) 1f else 0f
            weatherWeights[index] = moveToward(
                weatherWeights[index],
                target,
                weatherStep,
            )
        }
        normalize(weatherWeights)

        windClock += delta
        windDirection += (PI.toFloat() / 2f / WIND_DIRECTION_QUARTER_TURN_SECONDS) * delta

        val stormAmount = weatherWeights[SceneWeather.STORM.ordinal]
        val flash = advanceLightning(delta, stormAmount)
        latest = composeFrame(phasePalette, weatherWeights, flash)
        return latest
    }

    fun snapshot(): SceneAtmosphereFrame = latest

    private fun composeFrame(
        phase: PhasePalette,
        weights: FloatArray,
        lightning: Float = 0f,
    ): SceneAtmosphereFrame {
        fun weighted(selector: (WeatherTarget) -> Float): Float {
            var total = 0f
            SceneWeather.entries.forEach { weather ->
                total += weights[weather.ordinal] * selector(weatherTargets.getValue(weather))
            }
            return total
        }

        fun weightedColor(selector: (WeatherTarget) -> SceneColor): SceneColor {
            var red = 0f
            var green = 0f
            var blue = 0f
            SceneWeather.entries.forEach { weather ->
                val amount = weights[weather.ordinal]
                val color = selector(weatherTargets.getValue(weather))
                red += color.red * amount
                green += color.green * amount
                blue += color.blue * amount
            }
            return SceneColor(red, green, blue)
        }

        val desaturation = weighted { it.desaturation }
        val gray = SceneColor(.67f, .71f, .74f)
        val zenith = phase.zenith
            .lerp(gray, desaturation)
            .brighten(lightning * .62f)
        val horizon = phase.horizon
            .lerp(gray, desaturation)
            .brighten(lightning * .62f)
        val fog = phase.fog
            .lerp(gray, desaturation * .70f)
            .brighten(lightning * .56f)

        val rain = (
            weights[SceneWeather.RAIN.ordinal] +
                weights[SceneWeather.STORM.ordinal]
            ).coerceIn(0f, 1f)
        val snow = weights[SceneWeather.SNOW.ordinal].coerceIn(0f, 1f)
        val fogAmount = weights[SceneWeather.FOG.ordinal].coerceIn(0f, 1f)
        val windBase = weighted { it.wind }
        val gust = smoothNoise01(windClock * .15f)
        val windStrength = windBase + gust * (.35f + windBase * .40f)

        return SceneAtmosphereFrame(
            zenith = zenith,
            horizon = horizon,
            fog = fog,
            windowGlow = phase.windowGlow,
            eveningAmount = phase.eveningAmount,
            cloudCount = weighted { it.cloudCount },
            cloudOpacity = weighted { it.cloudOpacity },
            cloudColor = weightedColor { it.cloudColor },
            rainAmount = rain,
            snowAmount = snow,
            fogAmount = fogAmount,
            stormAmount = weights[SceneWeather.STORM.ordinal],
            wetness = max(rain, snow),
            lightning = lightning,
            windStrength = windStrength,
            windDirectionX = cos(windDirection),
            windDirectionZ = sin(windDirection),
        )
    }

    private fun advanceLightning(
        delta: Float,
        stormAmount: Float,
    ): Float {
        if (stormAmount <= .50f) {
            stormFlashSeconds = -1f
            stormWaitSeconds = max(stormWaitSeconds, 8f)
            return 0f
        }

        if (stormFlashSeconds < 0f) {
            stormWaitSeconds -= delta
            if (stormWaitSeconds <= 0f) {
                stormFlashSeconds = 0f
                stormSequence += 1
                stormWaitSeconds = 8f + pseudo(stormSequence * 79 + 11) * 12f
            }
            return 0f
        }

        stormFlashSeconds += delta
        return when {
            stormFlashSeconds < .08f -> stormFlashSeconds / .08f
            stormFlashSeconds < .33f -> 1f - (stormFlashSeconds - .08f) / .25f
            else -> {
                stormFlashSeconds = -1f
                0f
            }
        }
    }

    private companion object {
        const val WEATHER_TRANSITION_SECONDS = 4f
        const val PHASE_LERP_RATE = 1f
        const val WIND_DIRECTION_QUARTER_TURN_SECONDS = 10f * 60f
    }
}

internal data class SceneAtmosphereFrame(
    val zenith: SceneColor,
    val horizon: SceneColor,
    val fog: SceneColor,
    val windowGlow: Float,
    val eveningAmount: Float,
    val cloudCount: Float,
    val cloudOpacity: Float,
    val cloudColor: SceneColor,
    val rainAmount: Float,
    val snowAmount: Float,
    val fogAmount: Float,
    val stormAmount: Float,
    val wetness: Float,
    val lightning: Float,
    val windStrength: Float,
    val windDirectionX: Float,
    val windDirectionZ: Float,
)

internal data class SceneColor(
    val red: Float,
    val green: Float,
    val blue: Float,
) {
    fun lerp(other: SceneColor, amount: Float): SceneColor {
        val t = amount.coerceIn(0f, 1f)
        return SceneColor(
            red = red + (other.red - red) * t,
            green = green + (other.green - green) * t,
            blue = blue + (other.blue - blue) * t,
        )
    }

    fun brighten(amount: Float): SceneColor {
        val t = amount.coerceIn(0f, 1f)
        return lerp(SceneColor(1f, 1f, 1f), t)
    }
}

internal enum class SceneDayPhase {
    MORNING,
    DAY,
    EVENING,
    NIGHT,
}

internal fun sceneDayPhaseForHour(hour: Float): SceneDayPhase {
    val normalized = ((hour % 24f) + 24f) % 24f
    return when {
        normalized in 5f..<10f -> SceneDayPhase.MORNING
        normalized in 10f..<17f -> SceneDayPhase.DAY
        normalized in 17f..<21f -> SceneDayPhase.EVENING
        else -> SceneDayPhase.NIGHT
    }
}

fun sceneWeatherForWmoCode(code: Int?): SceneWeather = when {
    code == null || code == 0 -> SceneWeather.CLEAR
    code == 1 || code == 2 -> SceneWeather.PARTLY
    code == 3 -> SceneWeather.OVERCAST
    code == 45 || code == 48 -> SceneWeather.FOG
    code in 51..67 || code in 80..82 -> SceneWeather.RAIN
    code in 71..77 || code == 85 || code == 86 -> SceneWeather.SNOW
    code in 95..99 -> SceneWeather.STORM
    else -> SceneWeather.PARTLY
}

private data class PhasePalette(
    val zenith: SceneColor,
    val horizon: SceneColor,
    val fog: SceneColor,
    val windowGlow: Float,
    val eveningAmount: Float,
) {
    fun lerp(other: PhasePalette, amount: Float): PhasePalette = PhasePalette(
        zenith = zenith.lerp(other.zenith, amount),
        horizon = horizon.lerp(other.horizon, amount),
        fog = fog.lerp(other.fog, amount),
        windowGlow = windowGlow + (other.windowGlow - windowGlow) * amount,
        eveningAmount = eveningAmount + (other.eveningAmount - eveningAmount) * amount,
    )
}

private data class WeatherTarget(
    val cloudCount: Float,
    val cloudOpacity: Float,
    val cloudColor: SceneColor,
    val desaturation: Float,
    val wind: Float,
)

private val weatherTargets = mapOf(
    SceneWeather.CLEAR to WeatherTarget(3f, .70f, rgb("#FFFFFF"), 0f, .35f),
    SceneWeather.PARTLY to WeatherTarget(5f, .85f, rgb("#FFFFFF"), 0f, .35f),
    SceneWeather.OVERCAST to WeatherTarget(8f, .90f, rgb("#C8CCD2"), .20f, .35f),
    SceneWeather.FOG to WeatherTarget(2f, .40f, rgb("#D9DEE2"), .30f, .15f),
    SceneWeather.RAIN to WeatherTarget(7f, .90f, rgb("#8A94A2"), .30f, .60f),
    SceneWeather.SNOW to WeatherTarget(6f, .85f, rgb("#E8ECEF"), .15f, .45f),
    SceneWeather.STORM to WeatherTarget(8f, .95f, rgb("#59616E"), .45f, .90f),
)

private val morningPalette = PhasePalette(
        zenith = rgb("#A8CFE4"),
        horizon = rgb("#F4DFC0"),
        fog = rgb("#E4DED2"),
        windowGlow = 0f,
        eveningAmount = .08f,
    )
private val dayPalette = PhasePalette(
        zenith = rgb("#7AC7F2"),
        horizon = rgb("#CFE8F2"),
        fog = rgb("#BFE3F2"),
        windowGlow = 0f,
        eveningAmount = 0f,
    )
private val eveningPalette = PhasePalette(
        zenith = rgb("#7A9BC0"),
        horizon = rgb("#F0B57E"),
        fog = rgb("#DDB59A"),
        windowGlow = .80f,
        eveningAmount = .72f,
    )
private val nightPalette = PhasePalette(
        // The native art direction intentionally keeps the old night hues
        // lifted so the scene retains the brighter tone selected on-device.
        zenith = rgb("#426F98"),
        horizon = rgb("#6F829E"),
        fog = rgb("#536A86"),
        windowGlow = 1f,
        eveningAmount = 1f,
    )
private val sunrisePalette = PhasePalette(
        zenith = rgb("#8FA0C8"),
        horizon = rgb("#F2B98A"),
        fog = rgb("#D8B9A0"),
        windowGlow = 0f,
        eveningAmount = .08f,
    )
private val sunsetPalette = PhasePalette(
        zenith = rgb("#6F74A8"),
        horizon = rgb("#F09A6A"),
        fog = rgb("#D09A84"),
        windowGlow = 0f,
        eveningAmount = .45f,
    )

private fun paletteForHour(hour: Float): PhasePalette = when (sceneDayPhaseForHour(hour)) {
    SceneDayPhase.MORNING -> morningPalette
    SceneDayPhase.DAY -> dayPalette
    SceneDayPhase.EVENING -> eveningPalette
    SceneDayPhase.NIGHT -> nightPalette
}

/**
 * Location-aware phase bands from the predecessor. Solar elevation makes
 * twilight follow the real horizon instead of a fixed wall-clock interval.
 */
private fun paletteForSolarElevation(
    elevationDegrees: Float,
    beforeNoon: Boolean,
): PhasePalette {
    val twilight = if (beforeNoon) sunrisePalette else sunsetPalette
    val golden = if (beforeNoon) morningPalette else eveningPalette
    return when {
        elevationDegrees < -8f -> nightPalette
        elevationDegrees < 0f ->
            nightPalette.lerp(twilight, (elevationDegrees + 8f) / 8f)
        elevationDegrees < 10f ->
            twilight.lerp(golden, elevationDegrees / 10f)
        else -> dayPalette
    }
}

private fun rgb(hex: String): SceneColor {
    val value = hex.removePrefix("#").toInt(16)
    return SceneColor(
        red = ((value shr 16) and 255) / 255f,
        green = ((value shr 8) and 255) / 255f,
        blue = (value and 255) / 255f,
    )
}

private fun moveToward(
    value: Float,
    target: Float,
    maximumDelta: Float,
): Float = when {
    value < target -> (value + maximumDelta).coerceAtMost(target)
    value > target -> (value - maximumDelta).coerceAtLeast(target)
    else -> value
}

private fun normalize(values: FloatArray) {
    val sum = values.sum().coerceAtLeast(.0001f)
    values.indices.forEach { index -> values[index] /= sum }
}

private fun smoothNoise01(value: Float): Float {
    val a = sin(value)
    val b = sin(value * .37f + 1.7f)
    val c = sin(value * .71f + 4.2f)
    return .5f + .5f * ((a + b + c) / 3f)
}

private fun pseudo(seed: Int): Float {
    val value = sin(seed * 12.9898) * 43758.5453
    return (value - kotlin.math.floor(value)).toFloat()
}
