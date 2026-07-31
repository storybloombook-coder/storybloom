package com.storybloom.app.scene

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneMechanicsTest {
    @Test
    fun `intro camera ignores autoplay and holds for twelve seconds`() {
        val director = SceneIntroCameraDirector(mountedAtMs = 1_000L)

        assertEquals(
            SceneIntroCameraPhase.HOLDING,
            director.snapshot(nowMs = 12_999L).phase,
        )
        val handoff = director.snapshot(nowMs = 13_001L)
        assertEquals(SceneIntroCameraPhase.HANDOFF, handoff.phase)
        assertTrue(handoff.handoffProgress < .01f)
    }

    @Test
    fun `intro camera uses an eased three second handoff`() {
        val director = SceneIntroCameraDirector(mountedAtMs = 0L)

        val midpoint = director.snapshot(nowMs = 13_500L)
        assertEquals(SceneIntroCameraPhase.HANDOFF, midpoint.phase)
        assertEquals(.5f, midpoint.handoffProgress, .001f)

        assertEquals(
            SceneIntroCameraPhase.INACTIVE,
            director.snapshot(nowMs = 15_000L).phase,
        )
    }

    @Test
    fun `real camera input releases the intro immediately`() {
        val director = SceneIntroCameraDirector(mountedAtMs = 0L)
        director.releaseByCameraInput()

        assertEquals(
            SceneIntroCameraPhase.INACTIVE,
            director.snapshot(nowMs = 100L).phase,
        )
    }

    @Test
    fun `autoplay waits for launch idle then begins birth`() {
        val director = SceneStoryDirector()

        repeat(14) { director.advance(.1f) }
        assertEquals(SceneStoryMode.IDLE, director.snapshot().mode)

        repeat(2) { director.advance(.1f) }
        val started = director.snapshot()
        assertEquals(SceneStoryMode.PLAYING, started.mode)
        assertEquals(SceneStoryChapter.BIRTH, started.chapter)
    }

    @Test
    fun `scene input restarts the autoplay idle window`() {
        val director = SceneStoryDirector()

        repeat(14) { director.advance(.1f) }
        director.noteUserInput()
        repeat(14) { director.advance(.1f) }
        assertEquals(SceneStoryMode.IDLE, director.snapshot().mode)

        repeat(2) { director.advance(.1f) }
        assertEquals(SceneStoryMode.PLAYING, director.snapshot().mode)
    }

    @Test
    fun `reduced motion disables autoplay but leaves manual play available`() {
        val director = SceneStoryDirector()
        director.setAutoplayAllowed(false)

        repeat(30) { director.advance(.1f) }
        assertEquals(SceneStoryMode.IDLE, director.snapshot().mode)

        director.requestPlay()
        assertEquals(SceneStoryMode.PLAYING, director.snapshot().mode)
    }

    @Test
    fun `story runs at half speed and advances into first road`() {
        val director = SceneStoryDirector(autoplay = false)
        director.requestPlay()

        repeat(224) { director.advance(.1f) }
        val snapshot = director.snapshot()

        assertEquals(SceneStoryChapter.ROAD_TO_HARE, snapshot.chapter)
        assertTrue(snapshot.rolling)
    }

    @Test
    fun `pause and play restart the interrupted chapter`() {
        val director = SceneStoryDirector(autoplay = false)
        director.requestPlay()
        repeat(80) { director.advance(.1f) }
        assertTrue(director.snapshot().chapterSeconds > 3f)

        director.requestPause()
        assertEquals(SceneStoryMode.PAUSED, director.snapshot().mode)
        director.requestPlay()

        assertEquals(0f, director.snapshot().chapterSeconds, .0001f)
    }

    @Test
    fun `pause releases story owned dialogue poses and camera framing`() {
        val director = SceneStoryDirector(autoplay = false)
        director.requestPlay()
        repeat(84) { director.advance(.1f) }
        val cinematic = director.snapshot()
        assertTrue(
            cinematic.narration != null ||
                cinematic.positionOverride != null ||
                cinematic.windowGlow > 0f,
        )

        val paused = director.requestPause()

        assertEquals(SceneStoryMode.PAUSED, paused.mode)
        assertEquals(null, paused.narration)
        assertEquals(null, paused.speaker)
        assertEquals(null, paused.positionOverride)
        assertEquals(null, paused.storyActor)
        assertEquals(0f, paused.cameraPush, .0001f)
        assertEquals(0f, paused.windowGlow, .0001f)
        assertEquals(1f, paused.kolobokScale, .0001f)
        assertFalse(paused.singing)

        val nextRenderFrame = director.advance(1f / 60f)
        assertEquals(SceneStoryMode.PAUSED, nextRenderFrame.mode)
        assertEquals(null, nextRenderFrame.narration)
        assertEquals(null, nextRenderFrame.storyActor)
        assertEquals(null, nextRenderFrame.positionOverride)
        assertEquals(0f, nextRenderFrame.cameraPush, .0001f)
        assertFalse(nextRenderFrame.grandmaCooking)
    }

    @Test
    fun `standalone fox ending freezes the tale then resumes from the road`() {
        val director = SceneStoryDirector(autoplay = false)
        director.requestPlay()
        repeat(80) { director.advance(.1f) }

        val ending = director.startStandaloneFoxEnding()
        assertEquals(SceneStoryMode.OFF, ending.mode)
        assertEquals(null, ending.narration)
        assertEquals(null, ending.storyActor)

        repeat(40) { director.advance(.1f) }
        assertEquals(SceneStoryMode.OFF, director.snapshot().mode)

        val reborn = director.finishStandaloneFoxEnding()
        assertEquals(SceneStoryMode.PAUSED, reborn.mode)
        assertEquals(SceneStoryChapter.ROAD_TO_HARE, reborn.chapter)
        assertEquals(0f, reborn.kolobokAngleRadians, .0001f)
        assertEquals(1f, reborn.kolobokScale, .0001f)
    }

    @Test
    fun `paused autoplay restarts the interrupted chapter after eight idle seconds`() {
        val director = SceneStoryDirector()
        director.requestPlay()
        repeat(80) { director.advance(.1f) }
        director.requestPause()

        repeat(79) { director.advance(.1f) }
        assertEquals(SceneStoryMode.PAUSED, director.snapshot().mode)
        repeat(2) { director.advance(.1f) }

        assertEquals(SceneStoryMode.PLAYING, director.snapshot().mode)
        assertTrue(director.snapshot().chapterSeconds < .1f)
    }

    @Test
    fun `fox finale stops black and play begins rebirth`() {
        val director = SceneStoryDirector(autoplay = false)
        director.requestPlay()

        repeat(2600) {
            director.advance(.1f)
            if (director.snapshot().mode == SceneStoryMode.STOPPED) return@repeat
        }
        val stopped = director.snapshot()
        assertEquals(SceneStoryMode.STOPPED, stopped.mode)
        assertTrue(stopped.fadeBlack)
        assertEquals(0f, stopped.kolobokScale, .0001f)

        director.requestPlay()
        assertEquals(SceneStoryMode.REBIRTH, director.snapshot().mode)
        repeat(40) { director.advance(.1f) }
        assertFalse(director.snapshot().fadeBlack)
        assertTrue(director.snapshot().kolobokScale > 0f)
    }

    @Test
    fun `birth beat drives face look blink and windowsill wobble channels`() {
        val director = SceneStoryDirector(autoplay = false)
        director.requestPlay()

        repeat(115) { director.advance(.1f) }
        val look = director.snapshot()
        assertTrue(look.faceYawDegrees in -20f..20f)
        assertTrue(look.forcedBlink > .8f)

        repeat(43) { director.advance(.1f) }
        val wobble = director.snapshot()
        assertEquals(KolobokExpression.SLY, wobble.expression)
        assertTrue(kotlin.math.abs(wobble.bodyTiltDegrees) > .1f)
    }

    @Test
    fun `interactive encounter has approach dialogue song reaction and retreat`() {
        val director = SceneEncounterDirector()
        director.start(SceneActor.HARE, dialogueSuppressed = false)

        repeat(5) { director.advance(.1f) }
        assertEquals(SceneNarration.HARE_THREAT, director.snapshot().narration)
        assertTrue(director.snapshot().approach > .9f)

        repeat(10) { director.advance(.1f) }
        assertEquals(SceneNarration.KOLOBOK_SONG, director.snapshot().narration)
        assertTrue(director.snapshot().singing)

        repeat(7) { director.advance(.1f) }
        assertEquals(SceneNarration.KOLOBOK_SONG, director.snapshot().narration)
        assertFalse(director.snapshot().singing)

        repeat(16) { director.advance(.1f) }
        assertFalse(director.isRunning())
    }

    @Test
    fun `kolobok tap uses asymmetric hop and a separate landing squash`() {
        val director = SceneEncounterDirector()
        director.start(SceneActor.KOLOBOK, dialogueSuppressed = false)

        director.advance(.1f)
        val rising = director.snapshot()
        assertTrue(rising.kolobokHop > .5f)
        assertEquals(0f, rising.kolobokSquash, .0001f)

        director.advance(.25f)
        director.advance(.15f)
        val landing = director.snapshot()
        assertEquals(0f, landing.kolobokHop, .0001f)
        assertTrue(landing.kolobokSquash > .20f)
    }

    @Test
    fun `switching actors retreats the first before starting the second`() {
        val director = SceneEncounterDirector()
        director.start(SceneActor.WOLF, dialogueSuppressed = false)
        repeat(6) { director.advance(.1f) }

        director.start(SceneActor.BEAR, dialogueSuppressed = false)
        assertEquals(SceneActor.WOLF, director.snapshot().actor)

        repeat(4) { director.advance(.1f) }
        assertEquals(SceneActor.BEAR, director.snapshot().actor)
    }

    @Test
    fun `an active actor beat refuses a duplicate trigger`() {
        val director = SceneEncounterDirector()

        assertTrue(director.start(SceneActor.HARE, dialogueSuppressed = false))
        repeat(5) { director.advance(.1f) }
        val before = director.snapshot()

        assertFalse(director.start(SceneActor.HARE, dialogueSuppressed = false))
        assertEquals(before.approach, director.snapshot().approach, .0001f)
    }

    @Test
    fun `post story animal tap keeps the physical beat but has no dialogue`() {
        val director = SceneEncounterDirector()
        director.start(
            actor = SceneActor.BEAR,
            dialogueSuppressed = true,
            greetingOnly = true,
        )

        repeat(13) { director.advance(.1f) }
        val greeting = director.snapshot()
        assertEquals(SceneActor.BEAR, greeting.actor)
        assertTrue(greeting.greeting > .95f)
        assertTrue(greeting.approach > .95f)
        assertEquals(null, greeting.narration)

        repeat(21) { director.advance(.1f) }
        assertTrue(director.isRunning())

        repeat(4) { director.advance(.1f) }
        assertFalse(director.isRunning())
    }

    @Test
    fun `egg registry enforces cooldown exclusivity and per instance rules`() {
        val registry = SceneEggRegistry()

        assertTrue(registry.tryTrigger(SceneEgg.GRANDPA_FISHING, nowMs = 1_000L))
        assertFalse(registry.tryTrigger(SceneEgg.SMOKE_RINGS, nowMs = 2_000L))
        assertFalse(registry.tryTrigger(SceneEgg.GRANDPA_FISHING, nowMs = 7_000L))
        assertTrue(registry.tryTrigger(SceneEgg.GRANDPA_FISHING, nowMs = 9_100L))

        assertTrue(
            registry.tryTrigger(
                SceneEgg.CLOUD_DRIZZLE,
                nowMs = 9_200L,
                instance = 1,
            ),
        )
        assertFalse(
            registry.tryTrigger(
                SceneEgg.CLOUD_DRIZZLE,
                nowMs = 10_000L,
                instance = 1,
            ),
        )
        assertTrue(
            registry.tryTrigger(
                SceneEgg.CLOUD_DRIZZLE,
                nowMs = 10_000L,
                instance = 2,
            ),
        )
    }

    @Test
    fun `interactive encounter suppresses registry eggs`() {
        val registry = SceneEggRegistry()

        assertFalse(
            registry.tryTrigger(
                SceneEgg.MOON_WINK,
                nowMs = 1_000L,
                suppressed = true,
            ),
        )
        assertTrue(registry.tryTrigger(SceneEgg.MOON_WINK, nowMs = 1_001L))
    }

    @Test
    fun `egg exclusivity follows the actual animation duration`() {
        val normalCatch = SceneEggRegistry()
        assertTrue(
            normalCatch.tryTrigger(
                SceneEgg.GRANDPA_FISHING,
                nowMs = 1_000L,
                activeForMs = 2_700L,
            ),
        )
        assertFalse(normalCatch.tryTrigger(SceneEgg.MOON_WINK, nowMs = 3_699L))
        assertTrue(normalCatch.tryTrigger(SceneEgg.MOON_WINK, nowMs = 3_700L))

        val goldenCatch = SceneEggRegistry()
        assertTrue(
            goldenCatch.tryTrigger(
                SceneEgg.GRANDPA_FISHING,
                nowMs = 1_000L,
                activeForMs = 5_400L,
            ),
        )
        assertFalse(goldenCatch.tryTrigger(SceneEgg.SMOKE_RINGS, nowMs = 6_399L))
        assertTrue(goldenCatch.tryTrigger(SceneEgg.SMOKE_RINGS, nowMs = 6_400L))
    }

    @Test
    fun `chimney burst does not lock out another discovery`() {
        val registry = SceneEggRegistry()

        assertTrue(registry.tryTrigger(SceneEgg.SMOKE_RINGS, nowMs = 1_000L))
        assertTrue(registry.tryTrigger(SceneEgg.MOON_WINK, nowMs = 1_001L))
    }

    @Test
    fun `timed tap sequence uses a rolling window`() {
        val sequence = TimedTapSequence(requiredTaps = 3, windowMs = 3_000L)

        assertFalse(sequence.record(nowMs = 0L))
        assertFalse(sequence.record(nowMs = 2_900L))
        assertFalse(sequence.record(nowMs = 3_100L))
        assertTrue(sequence.record(nowMs = 4_000L))
    }

    @Test
    fun `timed tap sequence clears after firing and on reset`() {
        val sequence = TimedTapSequence(requiredTaps = 3, windowMs = 3_000L)

        assertFalse(sequence.record(nowMs = 1_000L))
        assertFalse(sequence.record(nowMs = 1_500L))
        sequence.reset()
        assertFalse(sequence.record(nowMs = 1_600L))
        assertFalse(sequence.record(nowMs = 1_700L))
        assertTrue(sequence.record(nowMs = 1_800L))
        assertFalse(sequence.record(nowMs = 1_900L))
    }

    @Test
    fun `launch idle window restarts after an interactive encounter`() {
        val director = SceneStoryDirector()

        repeat(8) { director.advance(.25f, blockedByEncounter = true) }
        assertEquals(SceneStoryMode.IDLE, director.snapshot().mode)

        repeat(5) { director.advance(.25f, blockedByEncounter = false) }
        assertEquals(SceneStoryMode.IDLE, director.snapshot().mode)

        director.advance(.25f, blockedByEncounter = false)
        assertEquals(SceneStoryMode.PLAYING, director.snapshot().mode)
    }

    @Test
    fun `paused resume window restarts after an interactive encounter`() {
        val director = SceneStoryDirector()
        director.requestPlay()
        repeat(4) { director.advance(.25f) }
        director.requestPause()

        repeat(36) { director.advance(.25f, blockedByEncounter = true) }
        assertEquals(SceneStoryMode.PAUSED, director.snapshot().mode)

        repeat(31) { director.advance(.25f, blockedByEncounter = false) }
        assertEquals(SceneStoryMode.PAUSED, director.snapshot().mode)

        director.advance(.25f, blockedByEncounter = false)
        assertEquals(SceneStoryMode.PLAYING, director.snapshot().mode)
    }
}
