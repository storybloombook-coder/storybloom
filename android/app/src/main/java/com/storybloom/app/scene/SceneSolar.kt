package com.storybloom.app.scene

import java.time.Instant
import java.time.ZoneOffset
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tan

/**
 * Low-precision NOAA solar position used by the original scene.
 *
 * It is intentionally pure so the renderer can recompute it once per minute
 * without retaining an Android location object or making another request.
 */
internal data class SceneSolarPosition(
    val elevationDegrees: Float,
    val azimuthDegrees: Float,
)

internal fun sceneSolarPosition(
    latitude: Double,
    longitude: Double,
    epochMillis: Long,
): SceneSolarPosition {
    val julianDay = epochMillis / 86_400_000.0 + 2_440_587.5
    val centuries = (julianDay - 2_451_545.0) / 36_525.0

    val meanLongitude = positiveDegrees(
        280.46646 + centuries * 36_000.76983,
    )
    val meanAnomaly = 357.52911 + centuries * 35_999.05029
    val eccentricity = 0.016708634 - centuries * 0.000042037
    val equationOfCenter =
        sin(degreesToRadians(meanAnomaly)) *
            (1.914602 - centuries * 0.004817) +
            sin(degreesToRadians(2.0 * meanAnomaly)) * 0.019993 +
            sin(degreesToRadians(3.0 * meanAnomaly)) * 0.000289
    val trueLongitude = meanLongitude + equationOfCenter
    val apparentLongitude =
        trueLongitude -
            0.00569 -
            0.00478 * sin(degreesToRadians(125.04 - 1_934.136 * centuries))
    val obliquity = 23.439291 - centuries * 0.0130042
    val declination = radiansToDegrees(
        asin(
            sin(degreesToRadians(obliquity)) *
                sin(degreesToRadians(apparentLongitude)),
        ),
    )

    val y = tan(degreesToRadians(obliquity / 2.0)).pow(2.0)
    val equationOfTime = 4.0 * radiansToDegrees(
        y * sin(2.0 * degreesToRadians(meanLongitude)) -
            2.0 * eccentricity * sin(degreesToRadians(meanAnomaly)) +
            4.0 * eccentricity * y *
            sin(degreesToRadians(meanAnomaly)) *
            cos(2.0 * degreesToRadians(meanLongitude)) -
            0.5 * y * y * sin(4.0 * degreesToRadians(meanLongitude)) -
            1.25 * eccentricity * eccentricity *
            sin(2.0 * degreesToRadians(meanAnomaly)),
    )

    val utc = Instant.ofEpochMilli(epochMillis).atZone(ZoneOffset.UTC)
    val utcMinutes =
        utc.hour * 60.0 +
            utc.minute +
            utc.second / 60.0 +
            utc.nano / 60_000_000_000.0
    val trueSolarMinutes =
        positiveModulo(utcMinutes + equationOfTime + 4.0 * longitude, 1_440.0)
    val hourAngle = trueSolarMinutes / 4.0 - 180.0

    val latitudeRadians = degreesToRadians(latitude)
    val declinationRadians = degreesToRadians(declination)
    val hourAngleRadians = degreesToRadians(hourAngle)
    val elevation = radiansToDegrees(
        asin(
            sin(latitudeRadians) * sin(declinationRadians) +
                cos(latitudeRadians) * cos(declinationRadians) * cos(hourAngleRadians),
        ),
    )
    val elevationRadians = degreesToRadians(elevation)
    val azimuthDenominator = cos(elevationRadians) * cos(latitudeRadians)
    val safeAzimuthDenominator = if (kotlin.math.abs(azimuthDenominator) < 1e-9) {
        1e-9
    } else {
        azimuthDenominator
    }
    val azimuthCosine = (
        (
            sin(declinationRadians) -
                sin(elevationRadians) * sin(latitudeRadians)
            ) / safeAzimuthDenominator
        ).coerceIn(-1.0, 1.0)
    var azimuth = radiansToDegrees(acos(azimuthCosine))
    if (hourAngle > 0.0) azimuth = 360.0 - azimuth

    return SceneSolarPosition(
        elevationDegrees = elevation.toFloat(),
        azimuthDegrees = positiveDegrees(azimuth).toFloat(),
    )
}

private fun positiveDegrees(value: Double): Double = positiveModulo(value, 360.0)

private fun positiveModulo(value: Double, modulus: Double): Double =
    ((value % modulus) + modulus) % modulus

private fun degreesToRadians(value: Double): Double = Math.toRadians(value)

private fun radiansToDegrees(value: Double): Double = Math.toDegrees(value)
