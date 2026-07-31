package com.storybloom.app.scene

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

internal enum class SceneIntroCameraPhase {
    HOLDING,
    HANDOFF,
    INACTIVE,
}

internal data class SceneIntroCameraSnapshot(
    val phase: SceneIntroCameraPhase,
    val handoffProgress: Float,
)

/**
 * The establishing shot has its own clock and ownership rules. Autoplay does
 * not release it; only the full hold elapsing or a real camera gesture does.
 */
internal class SceneIntroCameraDirector(
    private val mountedAtMs: Long,
) {
    private var releasedByUser = false

    fun releaseByCameraInput() {
        releasedByUser = true
    }

    fun snapshot(nowMs: Long): SceneIntroCameraSnapshot {
        if (releasedByUser) {
            return SceneIntroCameraSnapshot(
                phase = SceneIntroCameraPhase.INACTIVE,
                handoffProgress = 1f,
            )
        }
        val elapsed = (nowMs - mountedAtMs).coerceAtLeast(0L)
        if (elapsed < HOLD_MS) {
            return SceneIntroCameraSnapshot(
                phase = SceneIntroCameraPhase.HOLDING,
                handoffProgress = 0f,
            )
        }
        val linearProgress =
            ((elapsed - HOLD_MS).toFloat() / HANDOFF_MS).coerceIn(0f, 1f)
        if (linearProgress >= 1f) {
            return SceneIntroCameraSnapshot(
                phase = SceneIntroCameraPhase.INACTIVE,
                handoffProgress = 1f,
            )
        }
        val easedProgress =
            .5f - cos(linearProgress * PI.toFloat()) * .5f
        return SceneIntroCameraSnapshot(
            phase = SceneIntroCameraPhase.HANDOFF,
            handoffProgress = easedProgress,
        )
    }

    companion object {
        internal const val HOLD_MS = 12_000L
        internal const val HANDOFF_MS = 3_000f
    }
}

/**
 * The native scene's story clock.
 *
 * This deliberately mirrors the mechanics of the established scene instead
 * of treating the story as a looping caption carousel. Timeline time advances
 * at half speed so the tale keeps the calm, roughly two-minute pacing that was
 * tuned on-device in the predecessor.
 */
internal class SceneStoryDirector(
    autoplay: Boolean = true,
) {
    private var autoplayEnabled = autoplay
    private var mode = SceneStoryMode.IDLE
    private var chapterIndex = 0
    private var chapterSeconds = 0f
    private var launchIdleSeconds = 0f
    private var pausedIdleSeconds = 0f
    private var frozenSnapshot = initialStorySnapshot()

    fun advance(
        deltaSeconds: Float,
        blockedByEncounter: Boolean = false,
    ): SceneStorySnapshot {
        val delta = deltaSeconds.coerceIn(0f, MAX_FRAME_SECONDS)
        when (mode) {
            SceneStoryMode.IDLE -> {
                if (autoplayEnabled) {
                    if (blockedByEncounter) {
                        launchIdleSeconds = 0f
                    } else {
                        launchIdleSeconds += delta
                    }
                    if (launchIdleSeconds >= LAUNCH_IDLE_SECONDS) {
                        startChapter(0)
                    }
                }
            }

            SceneStoryMode.PLAYING -> {
                chapterSeconds += delta * STORY_TIME_SCALE
                val duration = CHAPTERS[chapterIndex].durationSeconds
                if (chapterSeconds >= duration) {
                    if (chapterIndex == CHAPTERS.lastIndex) {
                        mode = SceneStoryMode.STOPPED
                        chapterSeconds = duration
                    } else {
                        startChapter(chapterIndex + 1)
                    }
                }
            }

            SceneStoryMode.REBIRTH -> {
                chapterSeconds += delta * STORY_TIME_SCALE
                if (chapterSeconds >= REBIRTH_DURATION_SECONDS) {
                    startChapter(1)
                }
            }

            SceneStoryMode.PAUSED -> {
                if (autoplayEnabled) {
                    if (blockedByEncounter) {
                        pausedIdleSeconds = 0f
                    } else {
                        pausedIdleSeconds += delta
                    }
                    if (pausedIdleSeconds >= PAUSED_IDLE_RESUME_SECONDS) {
                        startChapter(chapterIndex)
                    }
                }
            }

            SceneStoryMode.STOPPED,
            SceneStoryMode.OFF,
            -> Unit
        }
        // PAUSED intentionally keeps the free-roam handoff produced by
        // requestPause(). Rebuilding the cinematic snapshot here would
        // resurrect its narration, actor pose and camera ownership on the
        // very next render frame.
        if (
            mode != SceneStoryMode.PAUSED &&
            mode != SceneStoryMode.OFF
        ) {
            frozenSnapshot = snapshotFor(mode, chapterIndex, chapterSeconds)
        }
        return snapshot()
    }

    fun requestPause(): SceneStorySnapshot {
        if (mode == SceneStoryMode.PLAYING || mode == SceneStoryMode.REBIRTH) {
            // Pausing hands the scene back to free mode. Preserve where
            // Kolobok reached on the path, but release every story-owned
            // pose, prop, camera push and line. Freezing the raw cinematic
            // snapshot left animals mid-lunge, Grandma mid-knead and a
            // narration bubble onscreen indefinitely.
            frozenSnapshot = freeModeSnapshot(
                snapshotFor(mode, chapterIndex, chapterSeconds),
            )
            mode = SceneStoryMode.PAUSED
            pausedIdleSeconds = 0f
        } else if (mode == SceneStoryMode.IDLE) {
            frozenSnapshot = freeModeSnapshot(initialStorySnapshot())
            mode = SceneStoryMode.PAUSED
            pausedIdleSeconds = 0f
        }
        return snapshot()
    }

    fun requestPlay(): SceneStorySnapshot {
        when (mode) {
            SceneStoryMode.PLAYING,
            SceneStoryMode.REBIRTH,
            -> Unit

            SceneStoryMode.STOPPED -> {
                mode = SceneStoryMode.REBIRTH
                chapterSeconds = 0f
            }

            SceneStoryMode.PAUSED -> startChapter(chapterIndex)
            SceneStoryMode.IDLE,
            SceneStoryMode.OFF,
            -> startChapter(0)
        }
        frozenSnapshot = snapshotFor(mode, chapterIndex, chapterSeconds)
        return frozenSnapshot
    }

    /**
     * The predecessor starts and resumes only after a genuine idle window.
     * Every touch resets that window without interrupting an already-running
     * chapter.
     */
    fun noteUserInput() {
        if (mode == SceneStoryMode.IDLE) launchIdleSeconds = 0f
        if (mode == SceneStoryMode.PAUSED) pausedIdleSeconds = 0f
    }

    fun setAutoplayAllowed(allowed: Boolean) {
        autoplayEnabled = allowed
        if (!allowed) {
            launchIdleSeconds = 0f
            pausedIdleSeconds = 0f
        }
    }

    fun stopForNavigation() {
        val current = snapshot()
        frozenSnapshot = freeModeSnapshot(current).copy(mode = SceneStoryMode.OFF)
        mode = SceneStoryMode.OFF
    }

    fun startStandaloneFoxEnding(): SceneStorySnapshot {
        frozenSnapshot = freeModeSnapshot(snapshot()).copy(
            mode = SceneStoryMode.OFF,
            expression = KolobokExpression.STARTLED,
        )
        mode = SceneStoryMode.OFF
        return frozenSnapshot
    }

    fun finishStandaloneFoxEnding(): SceneStorySnapshot {
        chapterIndex = 1
        chapterSeconds = 0f
        launchIdleSeconds = 0f
        pausedIdleSeconds = 0f
        frozenSnapshot = freeModeSnapshot(
            snapshotFor(
                currentMode = SceneStoryMode.PLAYING,
                currentChapter = chapterIndex,
                time = 0f,
            ),
        ).copy(
            mode = SceneStoryMode.PAUSED,
            expression = KolobokExpression.HAPPY,
        )
        mode = SceneStoryMode.PAUSED
        return frozenSnapshot
    }

    fun snapshot(): SceneStorySnapshot =
        if (
            mode == SceneStoryMode.PAUSED ||
            mode == SceneStoryMode.OFF
        ) {
            frozenSnapshot.copy(mode = mode)
        } else {
            snapshotFor(mode, chapterIndex, chapterSeconds)
        }

    private fun startChapter(index: Int) {
        chapterIndex = index.coerceIn(CHAPTERS.indices)
        chapterSeconds = 0f
        launchIdleSeconds = 0f
        pausedIdleSeconds = 0f
        mode = SceneStoryMode.PLAYING
    }

    private fun freeModeSnapshot(snapshot: SceneStorySnapshot): SceneStorySnapshot =
        snapshot.copy(
            mode = SceneStoryMode.PAUSED,
            narration = null,
            speaker = null,
            expression = KolobokExpression.NEUTRAL,
            kolobokScale = 1f,
            positionOverride = null,
            rolling = false,
            singing = false,
            spinTurns = 0f,
            squash = 0f,
            storyActor = null,
            storyActorApproach = 0f,
            storyActorReaction = 0f,
            cameraPush = 0f,
            windowGlow = 0f,
            smokeBoost = 1f,
            grandmaCooking = false,
            fadeBlack = false,
            faceYawDegrees = 0f,
            bodyTiltDegrees = 0f,
            forcedBlink = 0f,
            foxHeadPitch = 0f,
            catchBurst = 0f,
        )

    private fun snapshotFor(
        currentMode: SceneStoryMode,
        currentChapter: Int,
        time: Float,
    ): SceneStorySnapshot {
        if (currentMode == SceneStoryMode.IDLE) return initialStorySnapshot()
        if (currentMode == SceneStoryMode.REBIRTH) return rebirthSnapshot(time)

        val chapter = CHAPTERS[currentChapter.coerceIn(CHAPTERS.indices)]
        val t = time.coerceIn(0f, chapter.durationSeconds)
        val base = SceneStorySnapshot(
            mode = currentMode,
            chapter = chapter.chapter,
            chapterSeconds = t,
            chapterProgress = (t / chapter.durationSeconds).coerceIn(0f, 1f),
            kolobokAngleRadians = chapter.startAngleRadians,
            narration = null,
            speaker = null,
            expression = KolobokExpression.NEUTRAL,
            kolobokScale = 1f,
            positionOverride = null,
            rolling = false,
            singing = false,
            spinTurns = 0f,
            squash = 0f,
            storyActor = null,
            storyActorApproach = 0f,
            storyActorReaction = 0f,
            cameraPush = 0f,
            windowGlow = 0f,
            smokeBoost = 1f,
            grandmaCooking = false,
            fadeBlack = currentMode == SceneStoryMode.STOPPED,
        )

        return when (chapter.chapter) {
            SceneStoryChapter.BIRTH -> birthSnapshot(base, t)
            SceneStoryChapter.ROAD_TO_HARE,
            SceneStoryChapter.ROAD_TO_WOLF,
            SceneStoryChapter.ROAD_TO_BEAR,
            SceneStoryChapter.ROAD_TO_FOX,
            -> roadSnapshot(base, chapter, t)

            SceneStoryChapter.HARE,
            SceneStoryChapter.WOLF,
            SceneStoryChapter.BEAR,
            -> animalChapterSnapshot(base, chapter, t)

            SceneStoryChapter.FOX_FINALE -> foxFinaleSnapshot(base, t, currentMode)
        }
    }

    private fun birthSnapshot(base: SceneStorySnapshot, t: Float): SceneStorySnapshot {
        val sill = ScenePoint3(0f, 1.05f, 5.20f)
        val path = pointOnPath(BIRTH_STAGE_RADIANS, KOLOBOK_REST_Y)
        val popStart = 4.8f
        val popEnd = 5.3f
        val jumpStart = 8.8f
        val jumpEnd = 9.5f
        val settleStart = 9.8f
        val settleEnd = 11.2f

        val position = when {
            t < jumpStart -> sill
            t < jumpEnd -> {
                val p = easeInOutSine(unit(t, jumpStart, jumpEnd))
                lerp(sill, path, p).copy(y = lerp(sill.y, path.y, p) + sin(p * PI).toFloat() * .50f)
            }
            t < settleStart -> path
            else -> null
        }
        val scale = when {
            t < popStart -> 0f
            t < popEnd -> easeOutBack(unit(t, popStart, popEnd)).coerceAtLeast(0f)
            else -> 1f
        }
        val angle = if (t < settleStart) {
            BIRTH_STAGE_RADIANS
        } else {
            lerp(BIRTH_STAGE_RADIANS, IZBA_ANGLE, easeInOutSine(unit(t, settleStart, settleEnd)))
        }
        val narration = when {
            t in .4f..<2.2f -> SceneNarration.BAKE_START
            t in 2.2f..<7.0f -> SceneNarration.GRANDMA_COOKS
            t in 7.0f..<10.8f -> SceneNarration.OTHER_PLANS
            else -> null
        }
        val expression = when {
            t in 7.8f..<9.8f -> KolobokExpression.SLY
            t >= settleStart -> KolobokExpression.HAPPY
            else -> KolobokExpression.NEUTRAL
        }
        val landingSquash = if (t in 9.5f..<9.65f) {
            .30f * (1f - unit(t, 9.5f, 9.65f))
        } else {
            0f
        }
        val faceYaw = when {
            t < 5.6f -> 0f
            t < 6.8f -> lerp(-20f, 20f, easeInOutSine(unit(t, 5.6f, 6.8f)))
            t < 7.0f -> lerp(20f, 0f, unit(t, 6.8f, 7.0f))
            else -> 0f
        }
        val bodyTilt = if (t in 7.8f..<8.5f) {
            sin(unit(t, 7.8f, 8.5f) * PI.toFloat() * 4f) * 6f
        } else {
            0f
        }
        return base.copy(
            kolobokAngleRadians = angle,
            narration = narration,
            speaker = if (narration == null) null else SceneSpeaker.NARRATOR,
            expression = expression,
            kolobokScale = scale,
            positionOverride = position,
            rolling = t >= settleStart,
            spinTurns = if (t in settleStart..<10.8f) {
                easeInOutSine(unit(t, settleStart, 10.8f))
            } else {
                0f
            },
            squash = landingSquash,
            windowGlow = when {
                t < .8f -> unit(t, 0f, .8f)
                t < 10.8f -> 1f
                else -> 1f - unit(t, 10.8f, 11.2f)
            },
            smokeBoost = if (t < 10.8f) 2f else 1f,
            grandmaCooking = t < 4.6f,
            faceYawDegrees = faceYaw,
            bodyTiltDegrees = bodyTilt,
            forcedBlink = maxOf(
                blinkEnvelope(t, 5.7f),
                blinkEnvelope(t, 6.4f),
            ),
        )
    }

    private fun roadSnapshot(
        base: SceneStorySnapshot,
        chapter: ChapterSpec,
        t: Float,
    ): SceneStorySnapshot {
        val progress = unit(t, 0f, chapter.durationSeconds)
        return base.copy(
            kolobokAngleRadians = lerp(
                chapter.startAngleRadians,
                chapter.endAngleRadians,
                progress,
            ),
            expression = KolobokExpression.HAPPY,
            rolling = true,
            singing = t % 2f < .42f,
        )
    }

    private fun animalChapterSnapshot(
        base: SceneStorySnapshot,
        chapter: ChapterSpec,
        t: Float,
    ): SceneStorySnapshot {
        val actor = when (chapter.chapter) {
            SceneStoryChapter.HARE -> SceneActor.HARE
            SceneStoryChapter.WOLF -> SceneActor.WOLF
            SceneStoryChapter.BEAR -> SceneActor.BEAR
            else -> error("Not an animal chapter")
        }
        val approach = encounterApproach(t, STORY_ENCOUNTER_TIME_SCALE)
        val reaction = encounterReaction(t, STORY_ENCOUNTER_TIME_SCALE)
        val line = when {
            t in .58f..<1.885f -> when (actor) {
                SceneActor.HARE -> SceneNarration.HARE_THREAT
                SceneActor.WOLF -> SceneNarration.WOLF_THREAT
                SceneActor.BEAR -> SceneNarration.BEAR_THREAT
                else -> null
            }
            t in 1.885f..<6.4f -> SceneNarration.KOLOBOK_SONG
            t in 6.4f..<8f -> when (actor) {
                SceneActor.HARE -> SceneNarration.BRAG_GRANDMA
                SceneActor.WOLF -> SceneNarration.BRAG_WOLF
                SceneActor.BEAR -> SceneNarration.BRAG_BEAR
                else -> null
            }
            else -> null
        }
        val angle = if (t < 4.8f) {
            chapter.startAngleRadians
        } else {
            chapter.startAngleRadians +
                degreesToRadians(6f) * easeInOutSine(unit(t, 4.8f, 5.7f))
        }
        return base.copy(
            kolobokAngleRadians = angle,
            narration = line,
            speaker = when {
                line == null -> null
                line == SceneNarration.KOLOBOK_SONG ||
                    line == SceneNarration.BRAG_GRANDMA ||
                    line == SceneNarration.BRAG_WOLF ||
                    line == SceneNarration.BRAG_BEAR -> SceneSpeaker.KOLOBOK
                else -> actor.toSpeaker()
            },
            expression = if (t < .58f) KolobokExpression.STARTLED else KolobokExpression.HAPPY,
            rolling = t in 4.8f..<5.7f,
            singing = t in 1.885f..<2.90f,
            spinTurns = if (t in 1.885f..<2.90f) {
                easeInOutSine(unit(t, 1.885f, 2.90f))
            } else {
                0f
            },
            storyActor = actor,
            storyActorApproach = approach,
            storyActorReaction = reaction,
            cameraPush = approach * .04f,
            faceYawDegrees = if (t in 5.9f..<6.4f) {
                sin(unit(t, 5.9f, 6.4f) * PI).toFloat() * 30f
            } else {
                0f
            },
            forcedBlink = blinkEnvelope(t, 6.1f),
        )
    }

    private fun foxFinaleSnapshot(
        base: SceneStorySnapshot,
        t: Float,
        currentMode: SceneStoryMode,
    ): SceneStorySnapshot {
        val foxAngle = FOX_ANGLE
        val path = pointOnPath(foxAngle, KOLOBOK_REST_Y)
        val snout = pointOnPath(foxAngle, 1.07f, radius = 5.35f)
        val hopProgress = easeInOutSine(unit(t, 4.4f, 5.3f))
        val position = when {
            t < 4.4f -> null
            t < 5.3f -> {
                lerp(path, snout, hopProgress).copy(
                    y = lerp(path.y, snout.y, hopProgress) +
                        sin(hopProgress * PI).toFloat() * .35f,
                )
            }
            t < 5.8f -> snout
            t < 6.4f -> {
                val toss = easeOutCubic(unit(t, 5.8f, 6.4f))
                snout.copy(y = snout.y + .9f * toss)
            }
            else -> snout.copy(y = snout.y + .9f)
        }
        val scale = when {
            t < 6.4f -> 1f
            t < 6.7f -> 1f - unit(t, 6.4f, 6.7f)
            else -> 0f
        }
        val line = when {
            t < .8f -> SceneNarration.FOX_INTRO
            t < 3.4f -> SceneNarration.FOX_FLATTER
            t < 6.9f -> SceneNarration.FOX_CLOSER
            t < 9.2f -> SceneNarration.SNAP
            else -> null
        }
        return base.copy(
            mode = currentMode,
            kolobokAngleRadians = foxAngle +
                degreesToRadians(4f) * easeInOutSine(unit(t, 1.8f, 2.6f)),
            narration = if (currentMode == SceneStoryMode.STOPPED) null else line,
            speaker = when (line) {
                SceneNarration.FOX_FLATTER,
                SceneNarration.FOX_CLOSER,
                -> SceneSpeaker.FOX
                SceneNarration.SNAP,
                SceneNarration.FOX_INTRO,
                -> SceneSpeaker.NARRATOR
                else -> null
            },
            expression = if (t < 4.4f) KolobokExpression.SLY else KolobokExpression.STARTLED,
            kolobokScale = scale,
            positionOverride = position,
            rolling = t in 1.8f..<2.6f,
            singing = t in 1.8f..<3.2f,
            storyActor = SceneActor.FOX,
            // The finale's fox glides in once and holds that position so
            // her rendered snout remains under Kolobok's authored hop.
            storyActorApproach = if (t < .5f) {
                easeInOutSine(unit(t, 0f, .5f))
            } else {
                1f
            },
            storyActorReaction = if (t in 5.8f..<6.7f) {
                sin(unit(t, 5.8f, 6.7f) * PI).toFloat()
            } else {
                0f
            },
            cameraPush = when {
                t < 4.4f -> .02f
                t < 5.3f -> lerp(.02f, .12f, hopProgress)
                else -> .12f
            },
            fadeBlack = currentMode == SceneStoryMode.STOPPED || t >= 6.4f,
            bodyTiltDegrees = if (t in 5.3f..<5.8f) {
                sin(unit(t, 5.3f, 5.8f) * PI.toFloat() * 3f) * 5f
            } else {
                0f
            },
            foxHeadPitch = if (t in 5.8f..<6.4f) {
                easeOutCubic(unit(t, 5.8f, 6.4f))
            } else if (t >= 6.4f) {
                1f
            } else {
                0f
            },
            catchBurst = if (t in 6.4f..<7.15f) {
                1f - unit(t, 6.4f, 7.15f)
            } else {
                0f
            },
        )
    }

    private fun rebirthSnapshot(t: Float): SceneStorySnapshot {
        val time = t.coerceIn(0f, REBIRTH_DURATION_SECONDS)
        val sill = ScenePoint3(0f, 1.05f, 5.20f)
        val path = pointOnPath(BIRTH_STAGE_RADIANS, KOLOBOK_REST_Y)
        val pop = easeOutBack(unit(time, .9f, 1.4f)).coerceAtLeast(0f)
        val hop = easeInOutSine(unit(time, 2.3f, 2.8f))
        val position = when {
            time < .9f -> sill
            time < 2.3f -> sill
            time < 2.8f -> lerp(sill, path, hop).copy(
                y = lerp(sill.y, path.y, hop) + sin(hop * PI).toFloat() * .4f,
            )
            else -> null
        }
        return SceneStorySnapshot(
            mode = SceneStoryMode.REBIRTH,
            chapter = SceneStoryChapter.BIRTH,
            chapterSeconds = time,
            chapterProgress = time / REBIRTH_DURATION_SECONDS,
            kolobokAngleRadians = if (time < 2.8f) {
                BIRTH_STAGE_RADIANS
            } else {
                lerp(BIRTH_STAGE_RADIANS, IZBA_ANGLE, unit(time, 2.8f, 3.1f))
            },
            narration = if (time in .9f..<2.8f) SceneNarration.REBIRTH else null,
            speaker = if (time in .9f..<2.8f) SceneSpeaker.GRANDMA else null,
            expression = KolobokExpression.HAPPY,
            kolobokScale = if (time < .9f) 0f else pop.coerceAtMost(1.08f),
            positionOverride = position,
            rolling = time >= 2.8f,
            singing = false,
            spinTurns = 0f,
            squash = 0f,
            storyActor = null,
            storyActorApproach = 0f,
            storyActorReaction = 0f,
            cameraPush = 0f,
            windowGlow = 1f,
            smokeBoost = 2f,
            grandmaCooking = false,
            fadeBlack = time < .05f,
        )
    }

    private fun encounterApproach(
        t: Float,
        timeScale: Float = 1f,
    ): Float = when {
        t < .4f * timeScale ->
            easeOutCubic(unit(t, 0f, .4f * timeScale))
        t < 3.0f * timeScale -> 1f
        t < 3.7f * timeScale ->
            1f - easeInOutSine(unit(t, 3.0f * timeScale, 3.7f * timeScale))
        else -> 0f
    }

    private fun encounterReaction(
        t: Float,
        timeScale: Float = 1f,
    ): Float =
        if (t in (2.6f * timeScale)..<(3.0f * timeScale)) {
            sin(unit(t, 2.6f * timeScale, 3.0f * timeScale) * PI).toFloat()
        } else {
            0f
        }

    private fun blinkEnvelope(t: Float, start: Float): Float =
        if (t in start..(start + .12f)) {
            sin(unit(t, start, start + .12f) * PI).toFloat()
        } else {
            0f
        }

    companion object {
        internal const val LAUNCH_IDLE_SECONDS = 1.5f
        internal const val PAUSED_IDLE_RESUME_SECONDS = 8f
        internal const val STORY_TIME_SCALE = .5f
        private const val STORY_ENCOUNTER_TIME_SCALE = 1.45f
        private const val MAX_FRAME_SECONDS = .25f
        private const val REBIRTH_DURATION_SECONDS = 3.1f
        private const val KOLOBOK_REST_Y = .52f
        private val IZBA_ANGLE = degreesToRadians(0f)
        private val BIRTH_STAGE_RADIANS = degreesToRadians(30f)
        private val FOX_ANGLE = degreesToRadians(288f)
        private val CHAPTERS = listOf(
            ChapterSpec(SceneStoryChapter.BIRTH, 11.2f, BIRTH_STAGE_RADIANS, IZBA_ANGLE),
            ChapterSpec(SceneStoryChapter.ROAD_TO_HARE, 4.5f, degreesToRadians(0f), degreesToRadians(72f)),
            ChapterSpec(SceneStoryChapter.HARE, 8f, degreesToRadians(72f), degreesToRadians(78f)),
            ChapterSpec(SceneStoryChapter.ROAD_TO_WOLF, 4.5f, degreesToRadians(78f), degreesToRadians(144f)),
            ChapterSpec(SceneStoryChapter.WOLF, 8f, degreesToRadians(144f), degreesToRadians(150f)),
            ChapterSpec(SceneStoryChapter.ROAD_TO_BEAR, 4.5f, degreesToRadians(150f), degreesToRadians(216f)),
            ChapterSpec(SceneStoryChapter.BEAR, 8f, degreesToRadians(216f), degreesToRadians(222f)),
            ChapterSpec(SceneStoryChapter.ROAD_TO_FOX, 4.5f, degreesToRadians(222f), degreesToRadians(288f)),
            ChapterSpec(SceneStoryChapter.FOX_FINALE, 9.2f, degreesToRadians(288f), degreesToRadians(292f)),
        )
    }
}

/**
 * Interactive character beats are independent from the autoplaying tale.
 * Tapping a character while the tale is running still animates that actor,
 * but the tale's narration keeps ownership of the speech bubble.
 */
internal class SceneEncounterDirector {
    private var active: SceneActor? = null
    private var elapsedSeconds = 0f
    private var suppressDialogue = false
    private var greetingOnly = false
    private var retreatFrom = 0f
    private var retreatSeconds = 0f
    private var pending: PendingEncounter? = null

    fun start(
        actor: SceneActor,
        dialogueSuppressed: Boolean,
        greetingOnly: Boolean = false,
    ): Boolean {
        if (active == actor && retreatSeconds <= 0f) return false
        if (pending?.actor == actor) return false
        if (active != null && currentApproach() > 0f) {
            pending = PendingEncounter(actor, dialogueSuppressed, greetingOnly)
            retreatFrom = currentApproach()
            retreatSeconds = FORCED_RETREAT_SECONDS
            return true
        }
        active = actor
        elapsedSeconds = 0f
        suppressDialogue = dialogueSuppressed
        this.greetingOnly = greetingOnly
        retreatSeconds = 0f
        return true
    }

    fun cancel() {
        pending = null
        val approach = currentApproach()
        if (active != null && approach > 0f) {
            retreatFrom = approach
            retreatSeconds = FORCED_RETREAT_SECONDS
        } else {
            clear()
        }
    }

    fun advance(deltaSeconds: Float): SceneEncounterSnapshot {
        val actor = active ?: return SceneEncounterSnapshot()
        val delta = deltaSeconds.coerceIn(0f, .25f)
        if (retreatSeconds > 0f) {
            retreatSeconds = (retreatSeconds - delta).coerceAtLeast(0f)
            val fraction = retreatSeconds / FORCED_RETREAT_SECONDS
            val snapshot = SceneEncounterSnapshot(
                actor = actor,
                approach = retreatFrom * easeInOutSine(fraction),
                reaction = 0f,
                cameraPush = retreatFrom * fraction * .04f,
            )
            if (retreatSeconds <= 0f) {
                val next = pending
                clear()
                if (next != null) {
                    start(
                        actor = next.actor,
                        dialogueSuppressed = next.dialogueSuppressed,
                        greetingOnly = next.greetingOnly,
                    )
                }
            }
            return snapshot
        }

        elapsedSeconds += delta
        val duration = durationFor(actor)
        if (elapsedSeconds >= duration) {
            clear()
            return SceneEncounterSnapshot()
        }
        return snapshotFor(actor, elapsedSeconds, suppressDialogue, greetingOnly)
    }

    fun snapshot(): SceneEncounterSnapshot {
        val actor = active ?: return SceneEncounterSnapshot()
        if (retreatSeconds > 0f) {
            val fraction = retreatSeconds / FORCED_RETREAT_SECONDS
            return SceneEncounterSnapshot(
                actor = actor,
                approach = retreatFrom * easeInOutSine(fraction),
                cameraPush = retreatFrom * fraction * .04f,
            )
        }
        return snapshotFor(actor, elapsedSeconds, suppressDialogue, greetingOnly)
    }

    fun isRunning(): Boolean = active != null

    private fun snapshotFor(
        actor: SceneActor,
        t: Float,
        dialogueSuppressed: Boolean,
        greetingOnly: Boolean,
    ): SceneEncounterSnapshot {
        val suppressLine = dialogueSuppressed || greetingOnly
        if (actor == SceneActor.KOLOBOK) {
            val hop = when {
                t < .20f -> .60f * easeOutCubic(unit(t, 0f, .20f))
                t < .45f -> {
                    val fall = unit(t, .20f, .45f)
                    .60f * (1f - fall * fall)
                }
                else -> 0f
            }
            val landingSquash = if (t in .45f..<.57f) {
                .25f * sin(unit(t, .45f, .57f) * PI).toFloat()
            } else {
                0f
            }
            return SceneEncounterSnapshot(
                actor = actor,
                narration = if (suppressLine) null else SceneNarration.KOLOBOK_HUMS,
                speaker = if (suppressLine) null else SceneSpeaker.KOLOBOK,
                singing = t < 2.2f,
                kolobokHop = hop,
                kolobokSquash = landingSquash,
                kolobokSpinTurns = if (t < .9f) easeOutCubic(unit(t, 0f, .9f)) else 0f,
            )
        }
        if (actor == SceneActor.IZBA) {
            val envelope = sin(unit(t, 0f, 1.4f) * PI).toFloat().coerceAtLeast(0f)
            return SceneEncounterSnapshot(
                actor = actor,
                narration = if (suppressLine) null else SceneNarration.GRANDMA_TAP,
                speaker = if (suppressLine) null else SceneSpeaker.GRANDMA,
                approach = envelope,
                windowFlash = envelope,
                smokeBurst = t < .55f,
            )
        }

        val isFox = actor == SceneActor.FOX
        val approach = if (isFox) {
            when {
                t < .5f -> easeInOutSine(unit(t, 0f, .5f))
                t < 3.1f -> 1f
                t < 3.5f -> 1f - easeInOutSine(unit(t, 3.1f, 3.5f))
                else -> 0f
            }
        } else {
            when {
                t < .4f -> easeOutCubic(unit(t, 0f, .4f))
                t < 3f -> 1f
                t < 3.7f -> 1f - easeInOutSine(unit(t, 3f, 3.7f))
                else -> 0f
            }
        }
        val reaction = if (isFox) {
            if (t in 1.5f..<2.1f) sin(unit(t, 1.5f, 2.1f) * PI).toFloat() else 0f
        } else {
            if (t in 2.6f..<3f) sin(unit(t, 2.6f, 3f) * PI).toFloat() else 0f
        }
        val reactionProgress = if (isFox) {
            if (t in 1.5f..<2.1f) unit(t, 1.5f, 2.1f) else -1f
        } else {
            if (t in 2.6f..<3f) unit(t, 2.6f, 3f) else -1f
        }
        val line = if (suppressLine) {
            null
        } else if (isFox) {
            when {
                t in .5f..<2.4f -> SceneNarration.FOX_FLATTER
                t in 2.4f..<3.5f -> SceneNarration.KOLOBOK_SONG
                else -> null
            }
        } else {
            when {
                t in .4f..<1.3f -> when (actor) {
                    SceneActor.HARE -> SceneNarration.HARE_THREAT
                    SceneActor.WOLF -> SceneNarration.WOLF_THREAT
                    SceneActor.BEAR -> SceneNarration.BEAR_THREAT
                    else -> null
                }
                t in 1.3f..<3.7f -> SceneNarration.KOLOBOK_SONG
                else -> null
            }
        }
        return SceneEncounterSnapshot(
            actor = actor,
            narration = line,
            speaker = when {
                line == null -> null
                line == SceneNarration.KOLOBOK_SONG -> SceneSpeaker.KOLOBOK
                else -> actor.toSpeaker()
            },
            approach = approach,
            reaction = reaction,
            reactionProgress = reactionProgress,
            cameraPush = approach * .04f,
            singing = if (isFox) t in 2.4f..<3.1f else t in 1.3f..<2.0f,
            greeting = if (t < GREETING_SECONDS) {
                sin(unit(t, 0f, GREETING_SECONDS) * PI).toFloat()
            } else {
                0f
            },
            kolobokSpinTurns = when {
                isFox && t in 2.0f..<2.6f -> easeOutBack(unit(t, 2.0f, 2.6f))
                !isFox && t in 1.3f..<2f -> easeInOutSine(unit(t, 1.3f, 2f))
                else -> 0f
            },
        )
    }

    private fun currentApproach(): Float = snapshot().approach

    private fun durationFor(actor: SceneActor): Float = when (actor) {
        SceneActor.KOLOBOK -> 2.2f
        SceneActor.IZBA -> 1.4f
        SceneActor.FOX -> 3.5f
        else -> 3.7f
    }

    private fun clear() {
        active = null
        elapsedSeconds = 0f
        suppressDialogue = false
        greetingOnly = false
        retreatSeconds = 0f
        retreatFrom = 0f
        pending = null
    }

    private companion object {
        const val FORCED_RETREAT_SECONDS = .35f
        const val GREETING_SECONDS = 2.6f
    }

    private data class PendingEncounter(
        val actor: SceneActor,
        val dialogueSuppressed: Boolean,
        val greetingOnly: Boolean,
    )
}

/**
 * Shared discovery gate for hidden scene mechanics. It keeps cooldown and
 * exclusivity policy out of individual meshes, which prevents rapid taps on
 * overlapping hitboxes from starting contradictory sequences.
 */
internal class SceneEggRegistry {
    private val cooldownUntil = mutableMapOf<String, Long>()
    private var exclusiveUntilMs = 0L

    fun tryTrigger(
        egg: SceneEgg,
        nowMs: Long,
        instance: Int? = null,
        suppressed: Boolean = false,
        activeForMs: Long = egg.defaultActiveMs,
    ): Boolean {
        if (suppressed) return false
        if (!egg.independent && nowMs < exclusiveUntilMs) return false
        val key = if (instance == null) egg.name else "${egg.name}:$instance"
        if (nowMs < (cooldownUntil[key] ?: 0L)) return false

        cooldownUntil[key] = nowMs + egg.cooldownMs
        if (!egg.independent && activeForMs > 0L) {
            exclusiveUntilMs = nowMs + activeForMs
        }
        return true
    }
}

/**
 * Counts taps inside a rolling time window. Old timestamps are retained only
 * while they can still contribute, so a near-miss sequence can naturally
 * continue with later taps instead of being reset at an arbitrary boundary.
 */
internal class TimedTapSequence(
    private val requiredTaps: Int,
    private val windowMs: Long,
) {
    private val taps = ArrayDeque<Long>()

    init {
        require(requiredTaps > 0)
        require(windowMs >= 0L)
    }

    fun record(nowMs: Long): Boolean {
        while (taps.isNotEmpty() && nowMs - taps.first() > windowMs) {
            taps.removeFirst()
        }
        taps.addLast(nowMs)
        if (taps.size < requiredTaps) return false
        taps.clear()
        return true
    }

    fun reset() {
        taps.clear()
    }
}

internal data class SceneStorySnapshot(
    val mode: SceneStoryMode,
    val chapter: SceneStoryChapter,
    val chapterSeconds: Float,
    val chapterProgress: Float,
    val kolobokAngleRadians: Float,
    val narration: SceneNarration?,
    val speaker: SceneSpeaker?,
    val expression: KolobokExpression,
    val kolobokScale: Float,
    val positionOverride: ScenePoint3?,
    val rolling: Boolean,
    val singing: Boolean,
    val spinTurns: Float,
    val squash: Float,
    val storyActor: SceneActor?,
    val storyActorApproach: Float,
    val storyActorReaction: Float,
    val cameraPush: Float,
    val windowGlow: Float,
    val smokeBoost: Float,
    val grandmaCooking: Boolean,
    val fadeBlack: Boolean,
    val faceYawDegrees: Float = 0f,
    val bodyTiltDegrees: Float = 0f,
    val forcedBlink: Float = 0f,
    val foxHeadPitch: Float = 0f,
    val catchBurst: Float = 0f,
)

internal data class SceneEncounterSnapshot(
    val actor: SceneActor? = null,
    val narration: SceneNarration? = null,
    val speaker: SceneSpeaker? = null,
    val approach: Float = 0f,
    val reaction: Float = 0f,
    val reactionProgress: Float = -1f,
    val cameraPush: Float = 0f,
    val singing: Boolean = false,
    val kolobokHop: Float = 0f,
    val kolobokSquash: Float = 0f,
    val kolobokSpinTurns: Float = 0f,
    val greeting: Float = 0f,
    val windowFlash: Float = 0f,
    val smokeBurst: Boolean = false,
)

internal enum class SceneStoryMode {
    IDLE,
    PLAYING,
    PAUSED,
    STOPPED,
    REBIRTH,
    OFF,
}

internal enum class SceneStoryChapter {
    BIRTH,
    ROAD_TO_HARE,
    HARE,
    ROAD_TO_WOLF,
    WOLF,
    ROAD_TO_BEAR,
    BEAR,
    ROAD_TO_FOX,
    FOX_FINALE,
}

internal enum class SceneActor {
    IZBA,
    HARE,
    WOLF,
    BEAR,
    FOX,
    KOLOBOK,
}

internal enum class SceneSpeaker {
    NARRATOR,
    GRANDMA,
    HARE,
    WOLF,
    BEAR,
    FOX,
    KOLOBOK,
}

internal enum class SceneNarration {
    BAKE_START,
    GRANDMA_COOKS,
    OTHER_PLANS,
    HARE_THREAT,
    WOLF_THREAT,
    BEAR_THREAT,
    FOX_INTRO,
    FOX_FLATTER,
    FOX_CLOSER,
    KOLOBOK_SONG,
    BRAG_GRANDMA,
    BRAG_WOLF,
    BRAG_BEAR,
    SNAP,
    REBIRTH,
    GRANDMA_TAP,
    KOLOBOK_HUMS,
}

internal enum class KolobokExpression {
    NEUTRAL,
    HAPPY,
    STARTLED,
    SLY,
}

internal enum class SceneEgg(
    val cooldownMs: Long,
    val defaultActiveMs: Long,
    val independent: Boolean = false,
) {
    GRANDPA_FISHING(8_000L, 2_700L),
    OWL(10_000L, 0L),
    MOON_WINK(15_000L, 400L),
    SMOKE_RINGS(10_000L, 0L),
    CLOUD_DRIZZLE(15_000L, 0L, independent = true),
    MAGPIES(10_000L, 0L, independent = true),
}

internal data class ScenePoint3(
    val x: Float,
    val y: Float,
    val z: Float,
)

private data class ChapterSpec(
    val chapter: SceneStoryChapter,
    val durationSeconds: Float,
    val startAngleRadians: Float,
    val endAngleRadians: Float,
)

private fun initialStorySnapshot() = SceneStorySnapshot(
    mode = SceneStoryMode.IDLE,
    chapter = SceneStoryChapter.BIRTH,
    chapterSeconds = 0f,
    chapterProgress = 0f,
    kolobokAngleRadians = degreesToRadians(30f),
    narration = null,
    speaker = null,
    expression = KolobokExpression.NEUTRAL,
    kolobokScale = 0f,
    positionOverride = ScenePoint3(0f, 1.05f, 5.20f),
    rolling = false,
    singing = false,
    spinTurns = 0f,
    squash = 0f,
    storyActor = null,
    storyActorApproach = 0f,
    storyActorReaction = 0f,
    cameraPush = 0f,
    windowGlow = 0f,
    smokeBoost = 1f,
    grandmaCooking = false,
    fadeBlack = false,
)

private fun SceneActor.toSpeaker(): SceneSpeaker = when (this) {
    SceneActor.IZBA -> SceneSpeaker.GRANDMA
    SceneActor.HARE -> SceneSpeaker.HARE
    SceneActor.WOLF -> SceneSpeaker.WOLF
    SceneActor.BEAR -> SceneSpeaker.BEAR
    SceneActor.FOX -> SceneSpeaker.FOX
    SceneActor.KOLOBOK -> SceneSpeaker.KOLOBOK
}

private fun pointOnPath(
    angleRadians: Float,
    y: Float,
    radius: Float = SceneMotion.PATH_RADIUS,
): ScenePoint3 = ScenePoint3(
    x = sin(angleRadians) * radius,
    y = y,
    z = cos(angleRadians) * radius,
)

private fun lerp(a: Float, b: Float, t: Float): Float = a + (b - a) * t

private fun lerp(a: ScenePoint3, b: ScenePoint3, t: Float): ScenePoint3 = ScenePoint3(
    x = lerp(a.x, b.x, t),
    y = lerp(a.y, b.y, t),
    z = lerp(a.z, b.z, t),
)

private fun unit(value: Float, start: Float, end: Float): Float {
    if (end <= start) return if (value >= end) 1f else 0f
    return ((value - start) / (end - start)).coerceIn(0f, 1f)
}

private fun easeOutCubic(t: Float): Float {
    val oneMinus = 1f - t.coerceIn(0f, 1f)
    return 1f - oneMinus * oneMinus * oneMinus
}

private fun easeInOutSine(t: Float): Float =
    (-(cos(PI * t.coerceIn(0f, 1f)) - 1.0) / 2.0).toFloat()

private fun easeOutBack(t: Float): Float {
    val value = t.coerceIn(0f, 1f)
    val c1 = 1.4f
    val c3 = c1 + 1f
    val shifted = value - 1f
    return 1f + c3 * shifted * shifted * shifted + c1 * shifted * shifted
}

private fun degreesToRadians(degrees: Float): Float =
    (degrees / 180f * PI).toFloat()
