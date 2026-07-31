package com.storybloom.app.scene

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneAtmosphereTest {
    @Test
    fun `device hour fallback maps the four predecessor phases`() {
        assertEquals(SceneDayPhase.NIGHT, sceneDayPhaseForHour(2f))
        assertEquals(SceneDayPhase.MORNING, sceneDayPhaseForHour(7f))
        assertEquals(SceneDayPhase.DAY, sceneDayPhaseForHour(13f))
        assertEquals(SceneDayPhase.EVENING, sceneDayPhaseForHour(19f))
        assertEquals(SceneDayPhase.NIGHT, sceneDayPhaseForHour(23f))
    }

    @Test
    fun `wmo codes map to all native weather states`() {
        assertEquals(SceneWeather.CLEAR, sceneWeatherForWmoCode(0))
        assertEquals(SceneWeather.PARTLY, sceneWeatherForWmoCode(2))
        assertEquals(SceneWeather.OVERCAST, sceneWeatherForWmoCode(3))
        assertEquals(SceneWeather.FOG, sceneWeatherForWmoCode(45))
        assertEquals(SceneWeather.RAIN, sceneWeatherForWmoCode(82))
        assertEquals(SceneWeather.SNOW, sceneWeatherForWmoCode(86))
        assertEquals(SceneWeather.STORM, sceneWeatherForWmoCode(96))
        assertEquals(SceneWeather.PARTLY, sceneWeatherForWmoCode(120))
    }

    @Test
    fun `weather ramps instead of popping`() {
        val director = SceneAtmosphereDirector(initialHour = 13f)
        director.setWeather(SceneWeather.RAIN)

        val early = director.advance(.25f, 13f)
        assertTrue(early.rainAmount in .01f..<.15f)

        repeat(15) { director.advance(.25f, 13f) }
        val settled = director.snapshot()
        assertTrue(settled.rainAmount > .99f)
        assertTrue(settled.cloudCount > 6.9f)
    }

    @Test
    fun `night remains legible while enabling night mechanics`() {
        val director = SceneAtmosphereDirector(initialHour = 2f)
        val night = director.snapshot()

        assertEquals(1f, night.eveningAmount, .001f)
        assertTrue(night.zenith.red > .20f)
        assertTrue(night.windowGlow >= 1f)
    }

    @Test
    fun `rain and snow share wetness but keep distinct particles`() {
        val director = SceneAtmosphereDirector(initialHour = 13f)
        director.setWeather(SceneWeather.SNOW)
        repeat(16) { director.advance(.25f, 13f) }
        val snow = director.snapshot()
        assertTrue(snow.snowAmount > .99f)
        assertTrue(snow.rainAmount < .01f)
        assertTrue(snow.wetness > .99f)
    }
}
