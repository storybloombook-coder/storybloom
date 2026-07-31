package com.storybloom.app.ui.components

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.storybloom.app.ui.theme.BloomBlue

/**
 * The native equivalent of the predecessor's TactileButton. Press depth,
 * darkening and haptics are kept in one primitive so every screen feels as
 * though it belongs to the same physical storybook.
 */
@Composable
fun TactileSurface(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(12.dp),
    containerColor: Color,
    contentColor: Color,
    borderColor: Color = Color.Black.copy(alpha = .06f),
    pressedScale: Float = .96f,
    liftedElevation: Dp = 4.dp,
    haptic: StoryHaptic = StoryHaptic.LIGHT,
    role: Role = Role.Button,
    content: @Composable BoxScope.(Color) -> Unit,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) pressedScale else 1f,
        animationSpec = tween(if (pressed) 78 else 128),
        label = "story control press",
    )
    val hostView = LocalView.current
    val density = LocalDensity.current
    val pressTravel = with(density) { 1.5.dp.toPx() }

    LaunchedEffect(pressed, enabled) {
        if (pressed && enabled && haptic != StoryHaptic.NONE) {
            hostView.performHapticFeedback(
                when (haptic) {
                    StoryHaptic.LIGHT -> HapticFeedbackConstants.KEYBOARD_TAP
                    StoryHaptic.MEDIUM -> HapticFeedbackConstants.CONTEXT_CLICK
                    StoryHaptic.NONE -> HapticFeedbackConstants.KEYBOARD_TAP
                },
            )
        }
    }

    Box(
        modifier = modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationY = if (pressed) pressTravel else 0f
            }
            .shadow(
                elevation = if (pressed) 1.dp else liftedElevation,
                shape = shape,
                ambientColor = Color.Black.copy(alpha = .18f),
                spotColor = Color.Black.copy(alpha = .18f),
            )
            .clip(shape)
            .background(if (enabled) containerColor else containerColor.copy(alpha = .52f))
            .border(1.dp, borderColor, shape)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = enabled,
                role = role,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        content(if (enabled) contentColor else contentColor.copy(alpha = .58f))
        if (pressed) {
            Box(
                Modifier
                    .matchParentSize()
                    .background(Color.Black.copy(alpha = .11f)),
            )
        }
    }
}

@Composable
fun StoryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    containerColor: Color = BloomBlue,
    contentColor: Color = Color.White,
    leading: (@Composable () -> Unit)? = null,
) {
    TactileSurface(
        onClick = onClick,
        modifier = modifier.defaultMinSize(minHeight = 52.dp),
        enabled = enabled,
        containerColor = containerColor,
        contentColor = contentColor,
        borderColor = Color.White.copy(alpha = .16f),
    ) { resolvedContentColor ->
        Row(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (leading != null) {
                leading()
                Spacer(Modifier.size(9.dp))
            }
            androidx.compose.material3.Text(
                text = text,
                color = resolvedContentColor,
                style = androidx.compose.material3.MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
fun StoryIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    containerColor: Color = Color.Transparent,
    contentColor: Color = androidx.compose.material3.MaterialTheme.colorScheme.onSurface,
    haptic: StoryHaptic = StoryHaptic.LIGHT,
    content: @Composable BoxScope.(Color) -> Unit,
) {
    TactileSurface(
        onClick = onClick,
        modifier = modifier.size(44.dp),
        enabled = enabled,
        shape = CircleShape,
        containerColor = containerColor,
        contentColor = contentColor,
        borderColor = Color.Transparent,
        liftedElevation = 0.dp,
        haptic = haptic,
        content = content,
    )
}

@Composable
fun PulsingStoryDot(
    modifier: Modifier = Modifier,
    color: Color,
    size: Dp = 10.dp,
) {
    val transition = rememberInfiniteTransition(label = "live story pulse")
    val pulse by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(650),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "live story pulse amount",
    )
    Box(
        modifier = modifier.size(size * 2.2f),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(size * (1.55f + pulse * .65f))
                .graphicsLayer { alpha = .34f + pulse * .28f }
                .background(color, CircleShape),
        )
        Box(
            Modifier
                .size(size)
                .graphicsLayer {
                    scaleX = 1f + pulse * .14f
                    scaleY = 1f + pulse * .14f
                }
                .background(color, CircleShape),
        )
    }
}

enum class StoryHaptic {
    NONE,
    LIGHT,
    MEDIUM,
}

/**
 * A physical two-position switch for momentary story actions. It keeps the
 * predecessor's 52×30 proportions, 160 ms throw, press give and firm click.
 */
@Composable
fun StoryLightSwitch(
    on: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    onColor: Color = Color(0xFF2FB344),
    enabled: Boolean = true,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) .9f else 1f,
        animationSpec = tween(if (pressed) 80 else 120),
        label = "light switch press",
    )
    val thumbX by animateDpAsState(
        targetValue = if (on) 25.dp else 3.dp,
        animationSpec = tween(160),
        label = "light switch throw",
    )
    val trackColor by androidx.compose.animation.animateColorAsState(
        targetValue = if (on) onColor else MaterialTheme.colorScheme.outline.copy(alpha = .46f),
        animationSpec = tween(160),
        label = "light switch color",
    )
    val view = LocalView.current
    val density = LocalDensity.current
    Box(
        modifier = modifier
            .width(52.dp)
            .height(30.dp)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                alpha = if (enabled) 1f else .4f
            }
            .clip(CircleShape)
            .background(trackColor)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = enabled,
                role = Role.Switch,
            ) {
                view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                onToggle()
            },
    ) {
        Box(
            Modifier
                .padding(top = 3.dp)
                .graphicsLayer {
                    translationX = with(density) { thumbX.toPx() }
                    shadowElevation = with(density) { 2.dp.toPx() }
                    shape = CircleShape
                    clip = true
                }
                .size(24.dp)
                .background(Color.White, CircleShape),
        )
    }
}
