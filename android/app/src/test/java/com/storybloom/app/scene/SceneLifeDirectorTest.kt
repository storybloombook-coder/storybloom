package com.storybloom.app.scene

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneLifeDirectorTest {
    @Test
    fun `animal idle clocks are phase offset and not synchronized`() {
        val director = SceneLifeDirector(seed = 7)
        var sawHare = false
        var sawBear = false
        var sameFrame = true

        repeat(600) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.IZBA,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
            )
            if (director.hareHop > .01f) sawHare = true
            if (kotlin.math.abs(director.bearScratchDegrees) > .01f) sawBear = true
            if ((director.hareHop > .01f) !=
                (kotlin.math.abs(director.bearScratchDegrees) > .01f)
            ) {
                sameFrame = false
            }
        }

        assertTrue(sawHare)
        assertTrue(sawBear)
        assertTrue(!sameFrame)
    }

    @Test
    fun `story owned actor does not run a competing idle`() {
        val director = SceneLifeDirector(seed = 11)

        repeat(400) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.HARE,
                wetness = 0f,
                storyActor = SceneActor.HARE,
                encounterActor = null,
                nightAmount = 0f,
            )
            assertEquals(0f, director.hareHop, .0001f)
        }
    }

    @Test
    fun `wet animals shake only while idle`() {
        val director = SceneLifeDirector(seed = 19)
        var shook = false
        repeat(900) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.IZBA,
                wetness = 1f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
            )
            if (kotlin.math.abs(director.wetShakeDegrees(SceneActor.WOLF)) > .1f) {
                shook = true
            }
        }
        assertTrue(shook)

        repeat(40) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.WOLF,
                wetness = 1f,
                storyActor = null,
                encounterActor = SceneActor.WOLF,
                nightAmount = 0f,
            )
            assertEquals(0f, director.wolfHeadSweepDegrees, .0001f)
        }
    }

    @Test
    fun `izba extras obey active zone and daylight`() {
        val director = SceneLifeDirector(seed = 23)
        repeat(600) {
            director.advance(
                deltaSeconds = .05f,
                activeZone = SceneZone.WOLF,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
            )
            assertEquals(-1f, director.grandmaCrossing, .0001f)
            assertEquals(-1f, director.ridgeBirdVisit, .0001f)
        }

        var sawGrandma = false
        repeat(900) {
            director.advance(
                deltaSeconds = .05f,
                activeZone = SceneZone.IZBA,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 1f,
            )
            if (director.grandmaCrossing >= 0f) sawGrandma = true
            assertEquals(-1f, director.ridgeBirdVisit, .0001f)
        }
        assertTrue(sawGrandma)
    }

    @Test
    fun `pond life is irregular and grandpa does not recast while catching`() {
        val director = SceneLifeDirector(seed = 29)
        repeat(600) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.IZBA,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
                grandpaFishing = true,
            )
            assertEquals(-1f, director.grandpaRecast, .0001f)
        }

        var sawRecast = false
        var sawFish = false
        repeat(2_000) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.IZBA,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
            )
            if (director.grandpaRecast >= 0f) sawRecast = true
            if (director.pondFishSplash >= 0f) sawFish = true
        }
        assertTrue(sawRecast)
        assertTrue(sawFish)
    }

    @Test
    fun `kolobok blink is randomized and waits while singing`() {
        val director = SceneLifeDirector(seed = 31)
        repeat(600) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.IZBA,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
                kolobokSinging = true,
            )
            assertEquals(0f, director.kolobokEyelidClose, .0001f)
        }

        var sawBlink = false
        repeat(400) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.IZBA,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
            )
            if (director.kolobokEyelidClose > .5f) sawBlink = true
        }
        assertTrue(sawBlink)
    }

    @Test
    fun `active zones schedule their own ambient storylets`() {
        val director = SceneLifeDirector(seed = 37)
        repeat(700) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.IZBA,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
            )
            assertEquals(-1f, director.butterflyLanding, .0001f)
            assertEquals(-1f, director.crowFlight, .0001f)
            assertEquals(-1f, director.foxFeatherFall, .0001f)
            assertEquals(-1f, director.foxWatching, .0001f)
        }

        var sawButterflyLand = false
        repeat(700) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.HARE,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
            )
            if (director.butterflyLanding >= 0f) sawButterflyLand = true
        }
        assertTrue(sawButterflyLand)

        var sawCrow = false
        repeat(1_700) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.WOLF,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
            )
            if (director.crowFlight >= 0f) sawCrow = true
        }
        assertTrue(sawCrow)

        var sawFeather = false
        var sawWatch = false
        repeat(1_700) {
            director.advance(
                deltaSeconds = .02f,
                activeZone = SceneZone.FOX,
                wetness = 0f,
                storyActor = null,
                encounterActor = null,
                nightAmount = 0f,
            )
            if (director.foxFeatherFall >= 0f) sawFeather = true
            if (director.foxWatching >= 0f) sawWatch = true
        }
        assertTrue(sawFeather)
        assertTrue(sawWatch)
    }
}
