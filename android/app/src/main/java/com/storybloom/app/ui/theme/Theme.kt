package com.storybloom.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val BloomBlue = Color(0xFF208AEF)
val BloomNavy = Color(0xFF17345A)
val BloomCream = Color(0xFFFFF9F0)
val BloomYellow = Color(0xFFFFD34D)
val BloomCoral = Color(0xFFF17768)
val BloomGreen = Color(0xFF43A66B)
val BloomPurple = Color(0xFF8C6DD7)
val BloomInk = Color(0xFF18283D)
val StoryParchment = Color(0xFFFFF8EC)
val StoryPaper = Color(0xFFFFFCF6)
val StoryWood = Color(0xFF8A5A34)
val StoryWoodDark = Color(0xFF5F3B22)
val StoryCardLight = Color(0xFFFFFCF6)
val StoryCardDark = Color(0xFF211F1D)
val StorySubtleLight = Color(0xFF6E665D)
val StorySubtleDark = Color(0xFFA9A19A)

private val LightColors = lightColorScheme(
    primary = BloomBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE4F1FF),
    onPrimaryContainer = Color(0xFF0C4777),
    secondary = BloomCoral,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFDDD7),
    tertiary = BloomGreen,
    tertiaryContainer = Color(0xFFD0F2DC),
    background = StoryParchment,
    onBackground = Color(0xFF111113),
    surface = StoryCardLight,
    onSurface = Color(0xFF111113),
    surfaceVariant = Color(0xFFF1E8DB),
    onSurfaceVariant = StorySubtleLight,
    outline = Color(0xFFD9CFC1),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8CC7FF),
    onPrimary = Color(0xFF003258),
    primaryContainer = Color(0xFF0B4C7A),
    secondary = Color(0xFFFFB4A9),
    tertiary = Color(0xFF8ED6A8),
    background = Color(0xFF141311),
    onBackground = Color(0xFFF7F7F8),
    surface = StoryCardDark,
    onSurface = Color(0xFFF7F7F8),
    surfaceVariant = Color(0xFF302D29),
    onSurfaceVariant = StorySubtleDark,
    outline = Color(0xFF504A44),
)

private val StoryTypography = androidx.compose.material3.Typography(
    displayLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 34.sp,
        lineHeight = 40.sp,
    ),
    headlineLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
)

@Composable
fun StorybloomTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colors = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && darkTheme ->
            dynamicDarkColorScheme(context)
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            dynamicLightColorScheme(context)
        darkTheme -> DarkColors
        else -> LightColors
    }
    MaterialTheme(
        colorScheme = colors,
        typography = StoryTypography,
        content = content,
    )
}
