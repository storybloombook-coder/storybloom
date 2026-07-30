package com.storybloom.app.audio

data class SoundCategory(
    val label: String,
    val soundIds: List<String>,
)

object SoundLibrary {
    val ambientIds = listOf(
        "amb_forest",
        "amb_ocean",
        "amb_rain",
        "amb_night",
        "amb_indoors",
        "amb_city",
        "amb_meadow",
        "amb_jungle",
        "amb_beach",
        "amb_river",
        "amb_cave",
        "amb_snow",
        "amb_park",
        "amb_kitchen",
        "amb_bedroom",
        "amb_playground",
        "amb_space",
        "amb_underwater",
    )

    val effectCategories = listOf(
        SoundCategory(
            "Animals",
            listOf(
                "fx_animal_dog", "fx_animal_bird", "fx_animal_cat", "fx_animal_cow",
                "fx_animal_horse", "fx_animal_sheep", "fx_animal_pig", "fx_animal_duck",
                "fx_animal_rooster", "fx_animal_frog", "fx_animal_owl", "fx_animal_lion",
                "fx_animal_elephant", "fx_animal_monkey", "fx_animal_bee", "fx_animal_wolf",
                "fx_animal_mouse", "fx_animal_goat", "fx_animal_chicken", "fx_animal_snake",
                "fx_animal_cricket", "fx_animal_seagull", "fx_animal_whale",
                "fx_animal_cat_purr", "fx_animal_horse_gallop",
            ),
        ),
        SoundCategory(
            "Vehicles",
            listOf(
                "fx_engine", "fx_car_pass", "fx_car_horn", "fx_train", "fx_plane",
                "fx_helicopter", "fx_boat", "fx_siren", "fx_motorcycle",
                "fx_bicycle_bell", "fx_rocket",
            ),
        ),
        SoundCategory(
            "Nature & weather",
            listOf(
                "fx_thunder", "fx_wind", "fx_waves", "fx_waterfall", "fx_fire",
                "fx_leaves", "fx_rain", "fx_stream", "fx_splash",
            ),
        ),
        SoundCategory(
            "Household & objects",
            listOf(
                "fx_door", "fx_doorbell", "fx_knock", "fx_bell", "fx_clock", "fx_phone",
                "fx_switch", "fx_glass_clink", "fx_keys", "fx_zipper", "fx_scissors",
                "fx_camera", "fx_paper", "fx_creak", "fx_drawer", "fx_kettle", "fx_clap",
            ),
        ),
        SoundCategory(
            "Human & body",
            listOf(
                "fx_laugh", "fx_cry", "fx_cheer", "fx_snore", "fx_sneeze", "fx_cough",
                "fx_yawn", "fx_kiss", "fx_hiccup", "fx_gasp", "fx_whistle", "fx_gulp",
                "fx_eat", "fx_slurp", "fx_heartbeat", "fx_footsteps", "fx_footsteps_run",
            ),
        ),
        SoundCategory(
            "Toys, fun & games",
            listOf(
                "fx_pop", "fx_bubbles", "fx_squeak", "fx_boing", "fx_balloon",
                "fx_party_horn", "fx_drum", "fx_xylophone", "fx_twinkle", "fx_tada",
                "fx_buzz", "fx_coin", "fx_powerup", "fx_bounce", "fx_sparkle",
                "fx_magic", "fx_whoosh", "fx_swoosh",
            ),
        ),
        SoundCategory(
            "Music & bells",
            listOf("fx_chime", "fx_jingle", "fx_gong", "fx_music_box"),
        ),
        SoundCategory(
            "Impact & misc",
            listOf(
                "fx_plop", "fx_crunch", "fx_crash", "fx_bang", "fx_thud", "fx_ding",
                "fx_click", "fx_sizzle", "fx_drip", "fx_snap", "fx_splat", "fx_boom",
                "fx_roar", "fx_farm",
            ),
        ),
    )

    val effectIds = effectCategories.flatMap(SoundCategory::soundIds)
    val voiceIds = listOf(
        "voice_child",
        "voice_child_group",
        "voice_adult_warm",
        "voice_gruff",
        "voice_squeaky",
        "voice_animal",
        "voice_pip",
        "voice_posy",
    )

    fun label(soundId: String): String = soundId
        .removePrefix("amb_")
        .removePrefix("fx_")
        .removePrefix("voice_")
        .replace('_', ' ')
        .replaceFirstChar(Char::titlecase)

    fun assetPath(soundId: String): String? = when {
        soundId == "amb_playground" -> "sounds/ambient/amb_park.mp3"
        soundId == "fx_farm" -> "sounds/effects/fx_animal_pig.mp3"
        soundId == "fx_rocket" -> "sounds/effects/fx_whoosh.mp3"
        soundId.startsWith("amb_") && soundId in ambientIds ->
            "sounds/ambient/$soundId.mp3"
        soundId.startsWith("fx_") && soundId in effectIds ->
            "sounds/effects/$soundId.mp3"
        soundId.startsWith("voice_") && soundId in voiceIds ->
            "sounds/voices/$soundId.wav"
        else -> null
    }

    fun effectGain(soundId: String): Float = when (soundId) {
        "fx_animal_bird" -> .28f
        else -> 1f
    }

    fun ambientGain(soundId: String): Float = when (soundId) {
        "amb_bedroom", "amb_indoors" -> .30f
        else -> 1f
    }

    fun randomEffect(excluding: String? = null): String =
        effectIds.filterNot { it == excluding }.ifEmpty { effectIds }.random()

    fun randomAmbient(excluding: String? = null): String =
        ambientIds.filterNot { it == excluding }.ifEmpty { ambientIds }.random()
}
