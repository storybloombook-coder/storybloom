package com.storybloom.app.scene

import kotlin.math.PI
import kotlin.math.sin

/**
 * Randomized ambient behavior shared by the native scene actors.
 *
 * The previous implementation used modulo clocks, which made every idle
 * action predictable and allowed active-zone extras to run in every zone.
 * This director restores per-actor schedules, phase offsets, active-zone
 * frequency changes and rain/snow shake-off without involving Compose.
 */
internal class SceneLifeDirector(
    seed: Int = 0x51_0B_10,
) {
    private var randomState = seed
    private var elapsed = 0f

    private val hareHopClock = EventClock(nextIn = 1.6f)
    private val hareLeftEarClock = EventClock(nextIn = .7f)
    private val hareRightEarClock = EventClock(nextIn = 1.4f)
    private val wolfHowlClock = EventClock(nextIn = 6.8f)
    private val bearScratchClock = EventClock(nextIn = 5.2f)
    private val foxTiltClock = EventClock(nextIn = 4.4f)
    private val grandmaClock = EventClock(nextIn = 7.5f)
    private val ridgeBirdClock = EventClock(nextIn = 4.5f)
    private val distantBirdClock = EventClock(nextIn = 20f)
    private val butterflyLandingClock = EventClock(nextIn = 5.5f)
    private val crowFlightClock = EventClock(nextIn = 11f)
    private val foxFeatherClock = EventClock(nextIn = 9f)
    private val foxWatchClock = EventClock(nextIn = 5f)
    private val grandpaRecastClock = EventClock(nextIn = 8f)
    private val pondFishClock = EventClock(nextIn = 25f)
    private val wetClocks = Array(SceneActor.entries.size) { index ->
        EventClock(nextIn = 5f + index * 1.7f)
    }
    private var kolobokBlinkIn = 3.6f
    private var kolobokBlinkElapsed = -1f
    private var kolobokBlinkIsDouble = false

    var hareHop: Float = 0f
        private set
    var hareLeftEarDegrees: Float = 0f
        private set
    var hareRightEarDegrees: Float = 0f
        private set
    var wolfHeadSweepDegrees: Float = 0f
        private set
    var wolfHowlDegrees: Float = 0f
        private set
    var bearWeightShiftDegrees: Float = 0f
        private set
    var bearScratchDegrees: Float = 0f
        private set
    var bearScratchSide: Float = 0f
        private set
    var foxHeadTiltDegrees: Float = 0f
        private set
    var foxHalfBlink: Float = 0f
        private set
    var grandmaCrossing: Float = -1f
        private set
    var ridgeBirdVisit: Float = -1f
        private set
    var distantBirdVisit: Float = -1f
        private set
    var butterflyLanding: Float = -1f
        private set
    var crowFlight: Float = -1f
        private set
    var foxFeatherFall: Float = -1f
        private set
    var foxWatching: Float = -1f
        private set
    var grandpaRecast: Float = -1f
        private set
    var pondFishSplash: Float = -1f
        private set
    var kolobokEyelidClose: Float = 0f
        private set

    fun advance(
        deltaSeconds: Float,
        activeZone: SceneZone,
        wetness: Float,
        storyActor: SceneActor?,
        encounterActor: SceneActor?,
        nightAmount: Float,
        grandpaFishing: Boolean = false,
        kolobokSinging: Boolean = false,
    ) {
        val delta = deltaSeconds.coerceIn(0f, .25f)
        elapsed += delta

        fun idle(actor: SceneActor): Boolean =
            actor != storyActor && actor != encounterActor

        val hareIdle = idle(SceneActor.HARE)
        hareHop = tickPulse(
            hareHopClock,
            delta,
            hareIdle,
            duration = .30f,
            minimumNext = 2.5f,
            maximumNext = 4f,
            frequency = if (activeZone == SceneZone.HARE) 1.3f else 1f,
        ) * .12f
        hareLeftEarDegrees = tickSignedPulse(
            hareLeftEarClock,
            delta,
            hareIdle,
            duration = .15f,
            minimumNext = 1f,
            maximumNext = 3f,
            amplitude = 8f,
        )
        hareRightEarDegrees = tickSignedPulse(
            hareRightEarClock,
            delta,
            hareIdle,
            duration = .15f,
            minimumNext = 1f,
            maximumNext = 3f,
            amplitude = 8f,
        )

        val wolfIdle = idle(SceneActor.WOLF)
        wolfHeadSweepDegrees = if (wolfIdle) {
            sin(elapsed / 4f * PI.toFloat() * 2f) * 25f
        } else {
            0f
        }
        wolfHowlDegrees = tickHowl(
            wolfHowlClock,
            delta,
            wolfIdle,
            minimumNext = if (activeZone == SceneZone.WOLF) 5f else 10f,
            maximumNext = if (activeZone == SceneZone.WOLF) 7f else 14f,
        )

        val bearIdle = idle(SceneActor.BEAR)
        bearWeightShiftDegrees = if (bearIdle) sin(elapsed * .25f * PI.toFloat() * 2f) * 4f else 0f
        bearScratchDegrees = tickScratch(
            bearScratchClock,
            delta,
            bearIdle,
            frequency = if (activeZone == SceneZone.BEAR) 1.3f else 1f,
        )
        bearScratchSide = if (bearScratchDegrees == 0f) {
            0f
        } else {
            bearScratchClock.direction
        }

        val foxIdle = idle(SceneActor.FOX)
        val foxTilt = tickPulse(
            foxTiltClock,
            delta,
            foxIdle,
            duration = 1.55f,
            minimumNext = 6.5f,
            maximumNext = 9.5f,
            frequency = if (activeZone == SceneZone.FOX) 1.3f else 1f,
        )
        foxHeadTiltDegrees = foxTilt * 12f
        foxHalfBlink = foxTilt

        grandmaCrossing = tickProgress(
            grandmaClock,
            delta,
            enabled = activeZone == SceneZone.IZBA && storyActor != SceneActor.IZBA,
            duration = 1.8f,
            minimumNext = 20f,
            maximumNext = 35f,
        )
        ridgeBirdVisit = tickProgress(
            ridgeBirdClock,
            delta,
            enabled = activeZone == SceneZone.IZBA && nightAmount < .5f,
            duration = 5.2f,
            minimumNext = 12f,
            maximumNext = 18f,
        )
        distantBirdVisit = tickProgress(
            distantBirdClock,
            delta,
            enabled = nightAmount < .15f,
            duration = 12f,
            minimumNext = 20f,
            maximumNext = 45f,
        )
        butterflyLanding = tickProgress(
            butterflyLandingClock,
            delta,
            enabled = activeZone == SceneZone.HARE,
            duration = 1.2f,
            minimumNext = 6f,
            maximumNext = 12f,
        )
        crowFlight = tickProgress(
            crowFlightClock,
            delta,
            enabled = activeZone == SceneZone.WOLF,
            duration = 2.5f,
            minimumNext = 20f,
            maximumNext = 30f,
        )
        foxFeatherFall = tickProgress(
            foxFeatherClock,
            delta,
            enabled = activeZone == SceneZone.FOX,
            duration = 4f,
            minimumNext = 18f,
            maximumNext = 24f,
        )
        foxWatching = tickProgress(
            foxWatchClock,
            delta,
            enabled = activeZone == SceneZone.FOX && idle(SceneActor.FOX),
            duration = .8f,
            minimumNext = 8f,
            maximumNext = 12f,
        )
        grandpaRecast = tickProgress(
            grandpaRecastClock,
            delta,
            enabled = !grandpaFishing,
            duration = .9f,
            minimumNext = 25.5f,
            maximumNext = 34.5f,
        )
        pondFishSplash = tickProgress(
            pondFishClock,
            delta,
            enabled = true,
            duration = 1.1f,
            minimumNext = 25f,
            maximumNext = 60f,
        )
        advanceKolobokBlink(delta, kolobokSinging)

        SceneActor.entries.forEach { actor ->
            val idleActor = actor.isAnimalActor() && idle(actor)
            tickWetShake(
                wetClocks[actor.ordinal],
                delta,
                enabled = idleActor && wetness > .30f,
            )
        }
    }

    fun wetShakeDegrees(actor: SceneActor): Float {
        if (!actor.isAnimalActor()) return 0f
        val clock = wetClocks[actor.ordinal]
        if (clock.elapsed < 0f) return 0f
        val decay = (1f - clock.elapsed / WET_SHAKE_DURATION).coerceIn(0f, 1f)
        return sin(clock.elapsed * 7f * PI.toFloat() * 2f) * 12f * decay
    }

    private fun advanceKolobokBlink(
        delta: Float,
        singing: Boolean,
    ) {
        if (kolobokBlinkElapsed >= 0f) {
            kolobokBlinkElapsed += delta
            kolobokEyelidClose = when {
                kolobokBlinkElapsed < .07f ->
                    smoothStep(kolobokBlinkElapsed / .07f)
                kolobokBlinkElapsed < .13f -> 1f
                kolobokBlinkElapsed < .22f ->
                    1f - smoothStep((kolobokBlinkElapsed - .13f) / .09f)
                else -> {
                    kolobokBlinkElapsed = -1f
                    if (!kolobokBlinkIsDouble && nextRandom() < .15f) {
                        kolobokBlinkIsDouble = true
                        kolobokBlinkElapsed = 0f
                    } else {
                        kolobokBlinkIsDouble = false
                        kolobokBlinkIn = randomBetween(3f, 5f)
                    }
                    0f
                }
            }
            return
        }
        kolobokEyelidClose = 0f
        if (singing) return
        kolobokBlinkIn -= delta
        if (kolobokBlinkIn <= 0f) {
            kolobokBlinkElapsed = 0f
        }
    }

    private fun tickPulse(
        clock: EventClock,
        delta: Float,
        enabled: Boolean,
        duration: Float,
        minimumNext: Float,
        maximumNext: Float,
        frequency: Float = 1f,
    ): Float {
        val progress = tickProgress(
            clock,
            delta * frequency,
            enabled,
            duration,
            minimumNext,
            maximumNext,
        )
        return if (progress < 0f) 0f else sin(progress * PI.toFloat()).coerceAtLeast(0f)
    }

    private fun tickSignedPulse(
        clock: EventClock,
        delta: Float,
        enabled: Boolean,
        duration: Float,
        minimumNext: Float,
        maximumNext: Float,
        amplitude: Float,
    ): Float {
        val value = tickPulse(
            clock,
            delta,
            enabled,
            duration,
            minimumNext,
            maximumNext,
        )
        return value * amplitude * clock.direction
    }

    private fun tickHowl(
        clock: EventClock,
        delta: Float,
        enabled: Boolean,
        minimumNext: Float,
        maximumNext: Float,
    ): Float {
        val progress = tickProgress(
            clock,
            delta,
            enabled,
            duration = 2f,
            minimumNext = minimumNext,
            maximumNext = maximumNext,
        )
        if (progress < 0f) return 0f
        return when {
            progress < .30f -> smoothStep(progress / .30f) * 35f
            progress < .75f -> 35f
            else -> (1f - smoothStep((progress - .75f) / .25f)) * 35f
        }
    }

    private fun tickScratch(
        clock: EventClock,
        delta: Float,
        enabled: Boolean,
        frequency: Float,
    ): Float {
        val progress = tickProgress(
            clock,
            delta * frequency,
            enabled,
            duration = .9f,
            minimumNext = 8f,
            maximumNext = 12f,
        )
        if (progress < 0f) return 0f
        return sin(progress * .9f * 6f * PI.toFloat() * 2f) *
            sin(progress * PI.toFloat()) * 12f
    }

    private fun tickWetShake(
        clock: EventClock,
        delta: Float,
        enabled: Boolean,
    ) {
        if (clock.elapsed >= 0f) {
            clock.elapsed += delta
            if (clock.elapsed >= WET_SHAKE_DURATION) {
                clock.elapsed = -1f
                clock.nextIn = randomBetween(8f, 15f)
            }
            return
        }
        if (!enabled) return
        clock.nextIn -= delta
        if (clock.nextIn <= 0f) clock.elapsed = 0f
    }

    private fun tickProgress(
        clock: EventClock,
        delta: Float,
        enabled: Boolean,
        duration: Float,
        minimumNext: Float,
        maximumNext: Float,
    ): Float {
        if (clock.elapsed >= 0f) {
            clock.elapsed += delta
            if (clock.elapsed >= duration) {
                clock.elapsed = -1f
                clock.nextIn = randomBetween(minimumNext, maximumNext)
                clock.direction = if (nextRandom() < .5f) -1f else 1f
                return -1f
            }
            return (clock.elapsed / duration).coerceIn(0f, 1f)
        }
        if (!enabled) return -1f
        clock.nextIn -= delta
        if (clock.nextIn <= 0f) {
            clock.elapsed = 0f
            return 0f
        }
        return -1f
    }

    private fun randomBetween(minimum: Float, maximum: Float): Float =
        minimum + (maximum - minimum) * nextRandom()

    private fun nextRandom(): Float {
        randomState = randomState * 1_664_525 + 1_013_904_223
        return ((randomState ushr 8) and 0x00FF_FFFF) / 16_777_215f
    }

    private data class EventClock(
        var nextIn: Float,
        var elapsed: Float = -1f,
        var direction: Float = 1f,
    )

    private companion object {
        const val WET_SHAKE_DURATION = .65f
    }
}

private fun SceneActor.isAnimalActor(): Boolean = when (this) {
    SceneActor.HARE,
    SceneActor.WOLF,
    SceneActor.BEAR,
    SceneActor.FOX,
    -> true

    SceneActor.IZBA,
    SceneActor.KOLOBOK,
    -> false
}

private fun smoothStep(value: Float): Float {
    val progress = value.coerceIn(0f, 1f)
    return progress * progress * (3f - 2f * progress)
}
