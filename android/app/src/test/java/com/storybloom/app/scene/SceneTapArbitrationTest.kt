package com.storybloom.app.scene

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneTapArbitrationTest {
    @Test
    fun `tree owns an unobstructed press`() {
        assertTrue(SceneTapArbitration.treeOwnsPress(.42f, .18f, null, null))
    }

    @Test
    fun `nearer character keeps tree from stealing press`() {
        assertFalse(
            SceneTapArbitration.treeOwnsPress(
                treeDepth = .64f,
                treeNormalizedDistance = .20f,
                foregroundDepth = .39f,
                foregroundNormalizedDistance = .28f,
            ),
        )
    }

    @Test
    fun `equal depth favors deliberate foreground interaction`() {
        assertFalse(
            SceneTapArbitration.treeOwnsPress(
                treeDepth = .5f,
                treeNormalizedDistance = .20f,
                foregroundDepth = .5f,
                foregroundNormalizedDistance = .28f,
            ),
        )
    }

    @Test
    fun `tree still owns press when it is visibly nearer`() {
        assertTrue(
            SceneTapArbitration.treeOwnsPress(
                treeDepth = .31f,
                treeNormalizedDistance = .18f,
                foregroundDepth = .58f,
                foregroundNormalizedDistance = .24f,
            ),
        )
    }

    @Test
    fun `transparent canopy fringe does not steal a centered character`() {
        assertFalse(
            SceneTapArbitration.treeOwnsPress(
                treeDepth = 13.28f,
                treeNormalizedDistance = .85f,
                foregroundDepth = 14.83f,
                foregroundNormalizedDistance = .11f,
            ),
        )
    }

    @Test
    fun `direct tree press still owns an overlapping loose prop target`() {
        assertTrue(
            SceneTapArbitration.treeOwnsPress(
                treeDepth = 10f,
                treeNormalizedDistance = .14f,
                foregroundDepth = 11.4f,
                foregroundNormalizedDistance = .62f,
            ),
        )
    }

    @Test
    fun `modest canopy overlap yields to a substantially better aimed target`() {
        assertFalse(
            SceneTapArbitration.treeOwnsPress(
                treeDepth = 10f,
                treeNormalizedDistance = .60f,
                foregroundDepth = 11.4f,
                foregroundNormalizedDistance = .20f,
            ),
        )
    }
}
