package com.storybloom.app.vision

import com.storybloom.app.data.CueDraft
import com.storybloom.app.data.CueType
import com.storybloom.app.data.PageAnalysis
import java.util.Locale

data class TriggerEntry(
    val soundId: String,
    val triggers: List<String>,
)

object LocalCueAnalyzer {
    private const val MAX_KEYWORD_CUES = 5
    private val suffixes = listOf("ing", "ed", "es", "s", "d")

    private val scenes = listOf(
        TriggerEntry("amb_forest", listOf("forest", "woods", "trees", "лес", "чаща", "деревья")),
        TriggerEntry("amb_ocean", listOf("sea", "beach", "waves", "ocean", "море", "пляж", "волны", "океан")),
        TriggerEntry("amb_rain", listOf("rain", "storm", "rainy", "дождь", "гроза", "ливень")),
        TriggerEntry("amb_night", listOf("night", "bedtime", "dark", "stars", "ночь", "ночью", "сон", "темно", "звёзды", "звезды")),
        TriggerEntry("amb_indoors", listOf("house", "room", "home", "indoors", "дом", "комната", "дома")),
        TriggerEntry("amb_city", listOf("town", "street", "city", "road", "город", "улица", "дорога")),
        TriggerEntry("amb_meadow", listOf("field", "meadow", "farm", "outdoors", "поле", "луг", "ферма")),
        TriggerEntry("amb_jungle", listOf("jungle", "rainforest", "vines", "джунгли", "тропики")),
        TriggerEntry("amb_beach", listOf("sand", "seaside", "shore", "песок", "берег")),
        TriggerEntry("amb_river", listOf("river", "stream", "creek", "река", "ручей")),
        TriggerEntry("amb_cave", listOf("cave", "cavern", "tunnel", "пещера", "тоннель")),
        TriggerEntry("amb_snow", listOf("snow", "winter", "ice", "frost", "снег", "зима", "лёд", "мороз")),
        TriggerEntry("amb_park", listOf("park", "garden", "парк", "сад")),
        TriggerEntry("amb_kitchen", listOf("kitchen", "cooking", "кухня", "готовил")),
        TriggerEntry("amb_bedroom", listOf("bedroom", "bed", "спальня", "кровать")),
        TriggerEntry("amb_playground", listOf("playground", "swings", "slide", "площадка", "качели")),
        TriggerEntry("amb_space", listOf("space", "planet", "moon", "rocket", "космос", "планета", "луна", "ракета")),
        TriggerEntry("amb_underwater", listOf("underwater", "deep sea", "под водой", "глубина")),
    )

    private val effects = listOf(
        TriggerEntry("fx_engine", listOf("engine", "car", "truck", "bus", "motor", "roared", "мотор", "машина", "автобус", "гудок")),
        TriggerEntry("fx_laugh", listOf("laugh", "laughed", "giggled", "hooray", "смеялся", "смеялась", "хихикал", "ура")),
        TriggerEntry("fx_splash", listOf("splash", "jumped in", "water", "плеск", "брызги", "плюх")),
        TriggerEntry("fx_footsteps", listOf("ran", "walked", "footsteps", "stomped", "бежал", "шла", "шёл", "шаги", "топал")),
        TriggerEntry("fx_door", listOf("door", "opened", "slammed", "дверь", "открыл", "хлопнула")),
        TriggerEntry("fx_knock", listOf("knock", "knocked", "стук", "постучал")),
        TriggerEntry("fx_bell", listOf("bell", "ring", "chimed", "колокольчик", "звонок", "звенел")),
        TriggerEntry("fx_thunder", listOf("thunder", "boom", "гром", "бум", "грохот")),
        TriggerEntry("fx_animal_dog", listOf("dog", "bark", "woof", "puppy", "собака", "лай", "гав", "щенок")),
        TriggerEntry("fx_animal_bird", listOf("bird", "tweet", "chirp", "птица", "чирик", "щебет")),
        TriggerEntry("fx_animal_cat", listOf("cat", "meow", "kitten", "кошка", "кот", "мяу")),
        TriggerEntry("fx_animal_cow", listOf("cow", "moo", "корова", "му")),
        TriggerEntry("fx_animal_horse", listOf("horse", "neigh", "лошадь", "конь", "иго-го")),
        TriggerEntry("fx_animal_sheep", listOf("sheep", "lamb", "baa", "овца", "ягнёнок", "бе-е")),
        TriggerEntry("fx_animal_pig", listOf("pig", "oink", "свинья", "хрю")),
        TriggerEntry("fx_animal_duck", listOf("duck", "quack", "утка", "кря")),
        TriggerEntry("fx_animal_frog", listOf("frog", "croak", "лягушка", "ква")),
        TriggerEntry("fx_animal_owl", listOf("owl", "hoot", "сова", "уху")),
        TriggerEntry("fx_animal_lion", listOf("lion", "лев")),
        TriggerEntry("fx_animal_elephant", listOf("elephant", "слон")),
        TriggerEntry("fx_animal_monkey", listOf("monkey", "обезьяна")),
        TriggerEntry("fx_animal_bee", listOf("bee", "buzzed", "пчела", "жужжал")),
        TriggerEntry("fx_animal_wolf", listOf("wolf", "howled", "волк", "выл")),
        TriggerEntry("fx_pop", listOf("pop", "burst", "bubble", "лопнул", "хлоп", "пузырь")),
        TriggerEntry("fx_whoosh", listOf("flew", "zoomed", "whoosh", "wind", "летел", "промчался", "свист", "ветер")),
        TriggerEntry("fx_magic", listOf("magic", "sparkle", "poof", "wish", "волшебство", "искры", "пуф", "желание")),
        TriggerEntry("fx_switch", listOf("switch", "light", "выключатель", "свет")),
        TriggerEntry("fx_cry", listOf("cry", "cried", "whimper", "плач", "плакал", "хныкал")),
        TriggerEntry("fx_cheer", listOf("cheer", "hooray", "ура", "радостно")),
        TriggerEntry("fx_snore", listOf("snore", "snored", "храп", "сопел")),
        TriggerEntry("fx_farm", listOf("farm", "barnyard", "ферма", "хлев")),
        TriggerEntry("fx_roar", listOf("roar", "roared", "рёв", "рычал")),
        TriggerEntry("fx_bubbles", listOf("bubbles", "soap", "пузыри", "мыло")),
        TriggerEntry("fx_train", listOf("train", "railway", "поезд", "паровоз")),
        TriggerEntry("fx_plane", listOf("plane", "airplane", "самолёт", "самолет")),
        TriggerEntry("fx_helicopter", listOf("helicopter", "вертолёт", "вертолет")),
        TriggerEntry("fx_boat", listOf("boat", "ship", "лодка", "корабль")),
        TriggerEntry("fx_siren", listOf("siren", "ambulance", "police", "сирена", "скорая", "полиция")),
        TriggerEntry("fx_rocket", listOf("rocket", "spaceship", "ракета", "корабль")),
        TriggerEntry("fx_waves", listOf("waves", "surf", "волны", "прибой")),
        TriggerEntry("fx_fire", listOf("fire", "flame", "костёр", "огонь", "пламя")),
        TriggerEntry("fx_rain", listOf("rain", "raindrops", "дождь", "капли")),
        TriggerEntry("fx_clock", listOf("clock", "ticked", "часы", "тикали")),
        TriggerEntry("fx_phone", listOf("phone", "telephone", "телефон")),
        TriggerEntry("fx_keys", listOf("keys", "key", "ключи", "ключ")),
        TriggerEntry("fx_paper", listOf("paper", "page", "бумага", "страница")),
        TriggerEntry("fx_kettle", listOf("kettle", "чайник")),
        TriggerEntry("fx_clap", listOf("clap", "clapped", "аплодисменты", "хлопал")),
        TriggerEntry("fx_sneeze", listOf("sneeze", "sneezed", "чихнул", "апчхи")),
        TriggerEntry("fx_cough", listOf("cough", "coughed", "кашель", "кашлял")),
        TriggerEntry("fx_yawn", listOf("yawn", "yawned", "зевнул", "зевота")),
        TriggerEntry("fx_kiss", listOf("kiss", "kissed", "поцелуй", "чмок")),
        TriggerEntry("fx_gasp", listOf("gasp", "gasped", "ахнул")),
        TriggerEntry("fx_eat", listOf("munch", "chew", "ate", "ел", "жевал", "ням")),
        TriggerEntry("fx_slurp", listOf("slurp", "sipped", "хлюп")),
        TriggerEntry("fx_footsteps_run", listOf("running", "dashed", "raced", "мчался")),
        TriggerEntry("fx_squeak", listOf("squeak", "squeaky", "пищит", "писк")),
        TriggerEntry("fx_boing", listOf("boing", "sprang", "пружина")),
        TriggerEntry("fx_balloon", listOf("balloon", "шарик")),
        TriggerEntry("fx_drum", listOf("drum", "барабан")),
        TriggerEntry("fx_tada", listOf("ta-da", "tada", "surprise", "та-да", "сюрприз")),
        TriggerEntry("fx_coin", listOf("coin", "treasure", "монета", "клад")),
        TriggerEntry("fx_bounce", listOf("bounce", "bounced", "отскок", "скачет")),
        TriggerEntry("fx_sparkle", listOf("glitter", "shine", "shimmer", "искорки", "блёстки")),
        TriggerEntry("fx_swoosh", listOf("swoosh", "swished", "swept", "вжух")),
        TriggerEntry("fx_crunch", listOf("crunch", "crunched", "хруст")),
        TriggerEntry("fx_crash", listOf("crash", "smashed", "разбил")),
        TriggerEntry("fx_bang", listOf("bang", "banged", "бах", "бабах")),
        TriggerEntry("fx_ding", listOf("ding", "dinged", "дзынь", "динь")),
        TriggerEntry("fx_drip", listOf("drip", "dripped", "кап")),
        TriggerEntry("fx_snap", listOf("snap", "snapped", "щёлк")),
        TriggerEntry("fx_boom", listOf("exploded", "blast", "взрыв")),
    )

    fun relatedSoundIds(
        query: String,
        ambient: Boolean,
        allowedIds: Collection<String>,
    ): Set<String> {
        val normalized = query.trim().lowercase(Locale.ROOT)
        if (normalized.isBlank()) return emptySet()
        return (if (ambient) scenes else effects)
            .asSequence()
            .filter { it.soundId in allowedIds }
            .filter { entry ->
                entry.triggers.any { trigger ->
                    val candidate = trigger.lowercase(Locale.ROOT)
                    normalized.contains(candidate) || candidate.contains(normalized)
                }
            }
            .map(TriggerEntry::soundId)
            .toSet()
    }

    fun soundMatchesSearch(
        soundId: String,
        query: String,
        ambient: Boolean,
    ): Boolean {
        val normalized = query.trim().lowercase(Locale.ROOT)
        if (normalized.isBlank()) return true
        if (soundId.lowercase(Locale.ROOT).contains(normalized)) return true
        return (if (ambient) scenes else effects)
            .firstOrNull { it.soundId == soundId }
            ?.triggers
            ?.any { it.lowercase(Locale.ROOT).contains(normalized) }
            ?: false
    }

    fun analyze(text: String, meanConfidence: Int = -1): PageAnalysis {
        val lower = text.lowercase(Locale.ROOT)
        val ambient = inferAmbient(lower)
        val keywordCues = effects
            .flatMap { entry ->
                entry.triggers.map { trigger ->
                    Triple(entry.soundId, trigger.lowercase(Locale.ROOT), wordIndex(lower, trigger.lowercase(Locale.ROOT)))
                }
            }
            .filter { it.third >= 0 }
            .sortedWith(
                compareBy<Triple<String, String, Int>> { it.third }
                    .thenByDescending { it.second.length },
            )
            .distinctBy { it.first }
            .take(MAX_KEYWORD_CUES)
            .map { (soundId, trigger, position) ->
                val end = (position + trigger.length).coerceAtMost(text.length)
                CueDraft(
                    triggerText = text.substring(position, end),
                    contextPhrase = text.substring(
                        (position - 20).coerceAtLeast(0),
                        (end + 20).coerceAtMost(text.length),
                    ).trim(),
                    charStart = position,
                    charEnd = end,
                    soundId = soundId,
                )
            }

        val quotePatterns = listOf(
            Regex("\"([^\"]{2,})\""),
            Regex("“([^”]{2,})”"),
            Regex("«([^»]{2,})»"),
        )
        val dialogue = quotePatterns.flatMap { pattern ->
            pattern.findAll(text).map { match ->
                val line = match.groupValues[1].trim()
                val position = text.indexOf(line, match.range.first)
                CueDraft(
                    type = CueType.CHARACTER,
                    triggerText = line,
                    contextPhrase = line,
                    charStart = position.takeIf { it >= 0 },
                    charEnd = position.takeIf { it >= 0 }?.plus(line.length),
                    soundId = null,
                    intensity = if (line.any(Char::isLetter) && line == line.uppercase()) "loud" else "normal",
                )
            }.toList()
        }

        return PageAnalysis(
            ocrText = text,
            backgroundScene = ambient?.removePrefix("amb_"),
            ambientSoundId = ambient,
            cues = keywordCues + dialogue,
            meanConfidence = meanConfidence,
        )
    }

    internal fun wordIndex(haystack: String, needle: String): Int {
        if (needle.isBlank()) return -1
        var from = 0
        while (from < haystack.length) {
            val position = haystack.indexOf(needle, from)
            if (position < 0) return -1
            val before = haystack.getOrNull(position - 1)
            if (before?.isLetter() != true) {
                val afterPosition = position + needle.length
                if (haystack.getOrNull(afterPosition)?.isLetter() != true) return position
                val latinTrigger = needle.all { !it.isLetter() || it in 'a'..'z' }
                if (latinTrigger && suffixes.any { suffix ->
                        haystack.startsWith(suffix, afterPosition) &&
                            haystack.getOrNull(afterPosition + suffix.length)?.isLetter() != true
                    }
                ) {
                    return position
                }
            }
            from = position + 1
        }
        return -1
    }

    private fun inferAmbient(text: String): String? = scenes
        .map { entry ->
            entry.soundId to entry.triggers.count { wordIndex(text, it.lowercase(Locale.ROOT)) >= 0 }
        }
        .maxByOrNull { it.second }
        ?.takeIf { it.second > 0 }
        ?.first
}
