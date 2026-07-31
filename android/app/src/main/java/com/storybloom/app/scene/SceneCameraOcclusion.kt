package com.storybloom.app.scene

import kotlin.math.sqrt

/**
 * Lightweight third-person camera occlusion for the close Kolobok orbit.
 *
 * Trees remain fully opaque everywhere else. Only foliage lying on the
 * finite hero-to-camera sightline fades, with a soft shoulder so it never
 * pops as the camera orbits past a branch.
 */
internal object SceneCameraOcclusion {
    /**
     * Clouds share roughly the same radial shell as the orbit camera. A cloud
     * that is technically in front of the camera can therefore turn its three
     * modest lobes into a screen-filling translucent wall. Fade that local
     * cluster over a broad shoulder while leaving the far sky authored at full
     * opacity.
     */
    fun cloudAlpha(
        distanceFromCamera: Float,
        hiddenUntil: Float = 9.5f,
        fullyVisibleAt: Float = 15.5f,
    ): Float {
        if (distanceFromCamera <= hiddenUntil) return 0f
        if (distanceFromCamera >= fullyVisibleAt) return 1f
        val progress =
            ((distanceFromCamera - hiddenUntil) / (fullyVisibleAt - hiddenUntil))
                .coerceIn(0f, 1f)
        return progress * progress * (3f - 2f * progress)
    }

    /**
     * Keeps the authored moving sky from crossing the persistent scene
     * heading. This is projection-based rather than a fixed world-space gap,
     * so the same cloud remains visible once an orbit carries it clear of the
     * header.
     */
    fun headerSafeAlpha(
        normalizedX: Float,
        normalizedY: Float,
    ): Float {
        val nearestX = normalizedX.coerceIn(.17f, .83f)
        val nearestY = normalizedY.coerceIn(-.02f, .125f)
        val dx = normalizedX - nearestX
        val dy = normalizedY - nearestY
        val distance = sqrt(dx * dx + dy * dy)
        val progress = (distance / .075f).coerceIn(0f, 1f)
        return progress * progress * (3f - 2f * progress)
    }

    fun clampDistanceForCircle(
        heroX: Float,
        heroZ: Float,
        desiredCameraX: Float,
        desiredCameraZ: Float,
        desiredDistance: Float,
        blockerX: Float,
        blockerZ: Float,
        blockerRadius: Float,
        minimumDistance: Float = 2.4f,
    ): Float {
        if (desiredDistance <= minimumDistance) return desiredDistance
        val rayX = desiredCameraX - heroX
        val rayZ = desiredCameraZ - heroZ
        val rayLengthSquared = rayX * rayX + rayZ * rayZ
        if (rayLengthSquared < .0001f) return desiredDistance

        val toCenterX = blockerX - heroX
        val toCenterZ = blockerZ - heroZ
        val along = (toCenterX * rayX + toCenterZ * rayZ) / rayLengthSquared
        if (along !in .02f..0.98f) return desiredDistance
        val closestX = heroX + rayX * along
        val closestZ = heroZ + rayZ * along
        val offsetX = blockerX - closestX
        val offsetZ = blockerZ - closestZ
        val perpendicularSquared = offsetX * offsetX + offsetZ * offsetZ
        val radiusSquared = blockerRadius * blockerRadius
        if (perpendicularSquared >= radiusSquared) return desiredDistance

        val rayLength = sqrt(rayLengthSquared)
        val halfChord = sqrt(radiusSquared - perpendicularSquared)
        val nearDistance = along * rayLength - halfChord
        val horizontalToBoom = desiredDistance / rayLength
        val safeDistance =
            (nearDistance * horizontalToBoom - .28f).coerceAtLeast(minimumDistance)
        return minOf(desiredDistance, safeDistance)
    }

    fun clampDistanceForRect(
        heroX: Float,
        heroZ: Float,
        desiredCameraX: Float,
        desiredCameraZ: Float,
        desiredDistance: Float,
        minX: Float,
        maxX: Float,
        minZ: Float,
        maxZ: Float,
        minimumDistance: Float = 2.4f,
    ): Float {
        if (desiredDistance <= minimumDistance) return desiredDistance
        val rayX = desiredCameraX - heroX
        val rayZ = desiredCameraZ - heroZ
        var near = 0f
        var far = 1f

        fun clip(origin: Float, direction: Float, minimum: Float, maximum: Float): Boolean {
            if (kotlin.math.abs(direction) < .0001f) {
                return origin in minimum..maximum
            }
            var first = (minimum - origin) / direction
            var second = (maximum - origin) / direction
            if (first > second) {
                val swap = first
                first = second
                second = swap
            }
            near = maxOf(near, first)
            far = minOf(far, second)
            return near <= far
        }

        if (!clip(heroX, rayX, minX, maxX)) return desiredDistance
        if (!clip(heroZ, rayZ, minZ, maxZ)) return desiredDistance
        if (far < 0f || near > 1f) return desiredDistance

        val safeRatio = (near - .055f).coerceAtLeast(minimumDistance / desiredDistance)
        return minOf(desiredDistance, desiredDistance * safeRatio)
    }

    fun treeAlpha(
        heroX: Float,
        heroZ: Float,
        cameraX: Float,
        cameraZ: Float,
        treeX: Float,
        treeZ: Float,
        treeRadius: Float,
    ): Float = sightlineAlpha(
        heroX = heroX,
        heroZ = heroZ,
        cameraX = cameraX,
        cameraZ = cameraZ,
        blockerX = treeX,
        blockerZ = treeZ,
        blockerRadius = treeRadius,
        minimumAlpha = .16f,
        shoulderWidth = .55f,
    )

    fun sightlineAlpha(
        heroX: Float,
        heroZ: Float,
        cameraX: Float,
        cameraZ: Float,
        blockerX: Float,
        blockerZ: Float,
        blockerRadius: Float,
        minimumAlpha: Float,
        shoulderWidth: Float,
    ): Float {
        val sightX = cameraX - heroX
        val sightZ = cameraZ - heroZ
        val sightLengthSquared = sightX * sightX + sightZ * sightZ
        if (sightLengthSquared < .01f) return 1f

        val fromHeroX = blockerX - heroX
        val fromHeroZ = blockerZ - heroZ
        val along = (
            (fromHeroX * sightX + fromHeroZ * sightZ) /
                sightLengthSquared
            )
        if (along !in .06f..0.94f) return 1f

        val closestX = heroX + sightX * along
        val closestZ = heroZ + sightZ * along
        val dx = blockerX - closestX
        val dz = blockerZ - closestZ
        val distance = sqrt(dx * dx + dz * dz)
        val core = blockerRadius.coerceAtLeast(.25f)
        val shoulder = core + shoulderWidth.coerceAtLeast(.05f)
        if (distance >= shoulder) return 1f
        val floor = minimumAlpha.coerceIn(0f, 1f)
        if (distance <= core) return floor

        val progress = (distance - core) / (shoulder - core)
        val smooth = progress * progress * (3f - 2f * progress)
        return floor + (1f - floor) * smooth
    }
}
