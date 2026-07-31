package com.storybloom.app.ui.mechanics

object WaveformTrimMath {
    const val Bars = 56
    const val MinimumHandleGap = 24f

    fun startFromPointer(
        pointerX: Float,
        endX: Float,
        width: Float,
        duration: Float,
    ): Float {
        if (width <= 0f || duration <= 0f) return 0f
        val x = pointerX.coerceIn(0f, (endX - MinimumHandleGap).coerceAtLeast(0f))
        return x / width * duration
    }

    fun endFromPointer(
        pointerX: Float,
        startX: Float,
        width: Float,
        duration: Float,
    ): Float {
        if (width <= 0f || duration <= 0f) return duration.coerceAtLeast(0f)
        val x = pointerX.coerceIn(
            (startX + MinimumHandleGap).coerceAtMost(width),
            width,
        )
        return x / width * duration
    }

    fun bucket(raw: List<Float>, bars: Int = Bars): List<Float> {
        if (bars <= 0) return emptyList()
        if (raw.isEmpty()) return List(bars) { .45f }
        return List(bars) { index ->
            val start = (index.toFloat() / bars * raw.size).toInt()
            val end = maxOf(
                start + 1,
                ((index + 1f) / bars * raw.size).toInt(),
            ).coerceAtMost(raw.size)
            raw.subList(start.coerceAtMost(raw.lastIndex), end)
                .average()
                .toFloat()
                .coerceAtLeast(.08f)
        }
    }
}
