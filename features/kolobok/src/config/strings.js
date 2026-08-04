// strings.js — full EN/RU copy deck (docs/STRINGS.md) + the t() lookup.
// ALL user-visible text in this package must go through t() -- no hardcoded
// copy in components. Russian lines use the traditional folk phrasing;
// don't "improve" them independently of STRINGS.md.

import * as Localization from 'expo-localization';

export const STRINGS = {
  en: {
    zone: {
      izba: "Grandma's izba",
      hare: 'Hare meadow',
      wolf: 'Wolf forest',
      bear: 'Bear thicket',
      fox: 'Fox clearing',
    },
    song: {
      full: '"I ran away from Grandma, I ran away from Grandpa — and I\'ll run away from you!"',
    },
    line: {
      eat: {
        hare: 'Hare: "Kolobok, Kolobok, I will eat you up!"',
        wolf: 'Wolf: "Kolobok, Kolobok, I will eat you up!"',
        bear: 'Bear: "Kolobok, Kolobok, I will eat you up!"',
      },
      fox: {
        flatter: 'Fox: "What a lovely song! Come closer, dear — I can\'t quite hear."',
      },
      grandma: {
        tap: 'Grandma: "Kolobok, where have you rolled off to again?"',
      },
    },
    story: {
      bake1: 'Grandma scraped the flour bin and mixed a little dough...',
      bake1b: '...kneading and shaping it into a small round bun.',
      bake2: '...and set him on the windowsill to cool. But Kolobok had other plans.',
      brag: {
        grandma: "And on he rolled — from Grandma and Grandpa he'd gotten away...",
        hare: "And on he rolled — from the Hare he'd gotten away...",
        wolf: "And on he rolled — from the Wolf he'd gotten away...",
        bear: "And on he rolled — from the Bear he'd gotten away...",
      },
      fox: {
        intro: 'But by the fox clearing sat someone very polite...',
        closer: 'Fox: "Closer still, sweet thing... sit right on my nose."',
      },
      snap: '...and SNAP! That is how the tale goes.',
      rebirth: 'But Grandma just smiled — and baked another.',
      egg: {
        rebirth: 'Grandma: "Fresh out of the oven — again!"',
      },
    },
    ui: {
      hint: 'Swipe to travel · tap a friend to say hello',
      playTale: 'Play the tale',
      pauseTale: 'Pause the tale',
      restartTale: 'Play the tale again',
      menu: {
        one: 'Add a Book',
        two: 'Create a Story',
        three: 'My Library',
      },
      enableFollow: 'Follow Kolobok',
      disableFollow: 'Free the camera',
      mainMenu: 'Main menu',
      switchLanguage: 'Switch to Russian',
      eggTooltip: 'Find all the secrets',
      soundLibrary: 'Sound library',
      muteSound: 'Mute sound',
      unmuteSound: 'Unmute sound',
    },
    sound: {
      title: 'Sound library',
      close: 'Close',
      category: {
        kolobok: 'Kolobok',
        animals: 'Animals',
        nature: 'Nature',
        interactions: 'Interactions',
        ui: 'UI & navigation',
        story: 'Story',
        dialogue: 'Story lines (voice the tale)',
        myAmbience: 'My ambience (day & night)',
      },
      badge: {
        default: 'Default',
        custom: 'Yours',
      },
      action: {
        play: 'Play',
        record: 'Record',
        reset: 'Reset',
        mute: 'Mute this sound',
        unmute: 'Unmute this sound',
        readFullPhrase: 'Read the full phrase',
        closeHint: 'Tap anywhere to close',
      },
      unit: {
        seconds: 's',
      },
      recording: {
        getReady: 'Get ready...',
        recording: 'Recording…',
        saved: 'Saved!',
        target: 'Target length',
        stopRecording: '⏹ Stop recording',
        cancel: 'Cancel recording',
        permissionTitle: 'Microphone access needed',
        permissionBody: 'Allow microphone access to record your own sound for this slot. You can keep using the default sound without it.',
      },
      myAmbienceTooltip: 'No time limit -- record as long as you like. It loops seamlessly once played.',
      slot: {
        kolobok: {
          roll: 'Rolling',
          hop: 'Hop',
          songNote1: 'Melody hum, no words (do)',
          songNote2: 'Melody hum, no words (re)',
          songNote3: 'Melody hum, no words (mi)',
          songNote4: 'Melody hum, no words (sol)',
          songNote5: 'Melody hum, no words (la)',
          hum: 'Road humming',
          startled: 'Startled gasp',
          spin: 'Spin whoosh',
          landingSquash: 'Landing squash',
          dustPuff: 'Dust puff',
          birthPop: 'Birth pop',
          gulp: 'Gulp (fox catch)',
          giggle: 'Happy giggle',
        },
        hare: {
          idleHop: 'Hare idle hop',
          sniff: 'Hare sniff',
          startled: 'Hare startled',
        },
        wolf: {
          headSweep: 'Wolf head sweep',
          howl: 'Wolf howl',
          snapMiss: 'Wolf snap (miss)',
        },
        bear: {
          scratch: 'Bear tree scratch',
          grunt: 'Bear grunt',
          swipeMiss: 'Bear swipe (miss)',
        },
        fox: {
          tailSway: 'Fox tail sway',
          purr: 'Fox purr',
          flatterCoo: 'Fox flattering coo',
          lipLick: 'Fox lip lick',
        },
        grandma: {
          hum: 'Grandma hum',
          tapReaction: 'Grandma: "where did you roll off to?"',
          knitClick: 'Grandma knitting',
        },
        grandpa: {
          castLine: 'Grandpa casts the line',
          catchCheer: 'Grandpa catch cheer',
          sighBoot: 'Grandpa sighs (boot)',
        },
        owl: {
          hoot: 'Owl hoot',
        },
        hedgehog: {
          waddle: 'Hedgehog waddle',
          squeak: 'Hedgehog squeak',
        },
        crow: {
          caw: 'Crow caw',
          wingFlap: 'Crow wing flap',
        },
        ridgeBird: {
          peck: 'Roof bird peck',
        },
        bee: {
          buzz: 'Bee buzz',
        },
        butterfly: {
          flutter: 'Butterfly flutter',
        },
        ambience: {
          wind: 'Wind (ambient)',
          rain: 'Rain (ambient)',
          thunder: 'Thunder',
          pondRipple: 'Pond ripple',
          forestBirds: 'Forest birds (day)',
          nightCrickets: 'Crickets (night)',
          izbaFire: 'Izba fireplace',
          leaves: 'Falling leaves',
        },
        ui: {
          tapBlip: 'Tap feedback',
          plaqueBlip: 'Signpost tap',
          menuOpen: 'Menu open',
          menuClose: 'Menu close',
          playPause: 'Play/pause button',
          eyeToggle: 'Eye toggle',
          langToggle: 'Language toggle',
          eggCounterTap: 'Egg counter tap',
          zoneSettle: 'Camera settle',
          narrationAppear: 'Narration appears',
        },
        egg: {
          fishSplash: 'Fish splash',
          bootThud: 'Boot thud',
          goldSparkle: 'Golden fish sparkle',
          mushroomPop: 'Mushroom pop',
          moonTwinkle: 'Moon twinkle',
          cloudDrizzle: 'Cloud drizzle',
        },
        chimney: {
          pipeClose: 'Chimney pipe close',
          bubbleRelease: 'Chimney bubbles release',
          bubbleShrink: 'Bubble shrink',
        },
        nav: {
          crossroadsOpen: 'Crossroads stone open',
        },
        story: {
          doughAppear: 'Dough appears',
          windowGlowSwell: 'Window glow swell',
          fadeToBlack: 'Fade to black',
          rebirthChime: 'Rebirth chime',
          loopTransition: 'Loop transition',
        },
        dialogue: {
          kolobokSong: 'Kolobok: "I ran away from Grandma..."',
          hareEat: 'Hare: "I will eat you up!"',
          wolfEat: 'Wolf: "I will eat you up!"',
          bearEat: 'Bear: "I will eat you up!"',
          foxFlatter: 'Fox: "What a lovely song!..."',
          foxCloser: 'Fox: "Closer still, sweet thing..."',
          grandmaTap: 'Grandma: "Where have you rolled off to?"',
          bake1: 'Narrator: "Grandma mixed a little dough..."',
          bake1b: 'Narrator: "...kneading it into a bun."',
          bake2: 'Narrator: "...set him on the windowsill..."',
          bragGrandma: 'Narrator: "From Grandma and Grandpa..."',
          bragHare: 'Narrator: "From the Hare he got away..."',
          bragWolf: 'Narrator: "From the Wolf he got away..."',
          bragBear: 'Narrator: "From the Bear he got away..."',
          foxIntro: 'Narrator: "Someone very polite..."',
          snap: 'Narrator: "...and SNAP!"',
          rebirth: 'Narrator: "Grandma baked another."',
          eggRebirth: 'Grandma: "Fresh out of the oven!"',
        },
        myAmbience: {
          day: 'My daytime ambience',
          night: 'My nighttime ambience',
        },
      },
    },
    weather: {
      permission: "Allow location so the sky above Kolobok matches yours — sunrise, clouds, even snow.",
    },
    egg: {
      fish: 'Grandpa: "Ooh, a fine one! Back you go."',
      boot: 'Grandpa: "A boot. Again."',
      goldfish: 'Grandpa: "A golden fish! I\'ll let you go, dear — no wishes needed today."',
    },
  },
  ru: {
    zone: {
      izba: 'Избушка бабушки',
      hare: 'Заячий луг',
      wolf: 'Волчий лес',
      bear: 'Медвежья чаща',
      fox: 'Лисья поляна',
    },
    song: {
      full: '«Я от бабушки ушёл, я от дедушки ушёл — и от тебя уйду!»',
    },
    line: {
      eat: {
        hare: 'Заяц: «Колобок, Колобок, я тебя съем!»',
        wolf: 'Волк: «Колобок, Колобок, я тебя съем!»',
        bear: 'Медведь: «Колобок, Колобок, я тебя съем!»',
      },
      fox: {
        flatter: 'Лиса: «Какая славная песенка! Подойди поближе, милый, — я стала глуховата.»',
      },
      grandma: {
        tap: 'Бабушка: «Колобок, куда ты опять укатился?»',
      },
    },
    story: {
      bake1: 'По амбару метено, по сусекам скребено — замесила бабушка тесто...',
      bake1b: '...и скатала из него колобок.',
      bake2: '...и положила на окошко студиться. Но у Колобка были свои планы.',
      brag: {
        grandma: 'И покатился дальше — от бабушки ушёл, от дедушки ушёл...',
        hare: 'И покатился дальше — и от зайца ушёл...',
        wolf: 'И покатился дальше — и от волка ушёл...',
        bear: 'И покатился дальше — и от медведя ушёл...',
      },
      fox: {
        intro: 'А на лисьей поляне сидел кое-кто очень вежливый...',
        closer: 'Лиса: «Сядь ко мне на носок да спой ещё разок!»',
      },
      snap: '...ам! — вот и сказке конец.',
      rebirth: 'А бабушка улыбнулась — и испекла нового.',
      egg: {
        rebirth: 'Бабушка: «Только из печки — опять!»',
      },
    },
    ui: {
      hint: 'Проведите пальцем — и в путь · нажмите на героя',
      playTale: 'Рассказать сказку',
      pauseTale: 'Остановить сказку',
      restartTale: 'Рассказать сказку снова',
      menu: {
        one: 'Новая книга',
        two: 'Своя история',
        three: 'Библиотека',
      },
      enableFollow: 'Следовать за Колобком',
      disableFollow: 'Свободная камера',
      mainMenu: 'Главное меню',
      switchLanguage: 'Переключить на английский',
      eggTooltip: 'Найди все секреты',
      soundLibrary: 'Библиотека звуков',
      muteSound: 'Выключить звук',
      unmuteSound: 'Включить звук',
    },
    sound: {
      title: 'Библиотека звуков',
      close: 'Закрыть',
      category: {
        kolobok: 'Колобок',
        animals: 'Звери',
        nature: 'Природа',
        interactions: 'Взаимодействия',
        ui: 'Интерфейс и навигация',
        story: 'Сказка',
        dialogue: 'Реплики сказки (озвучка)',
        myAmbience: 'Моя атмосфера (день и ночь)',
      },
      badge: {
        default: 'По умолчанию',
        custom: 'Ваш',
      },
      action: {
        play: 'Слушать',
        record: 'Записать',
        reset: 'Сбросить',
        mute: 'Выключить этот звук',
        unmute: 'Включить этот звук',
        readFullPhrase: 'Прочитать фразу целиком',
        closeHint: 'Нажмите в любом месте, чтобы закрыть',
      },
      unit: {
        seconds: 'с',
      },
      recording: {
        getReady: 'Приготовьтесь...',
        recording: 'Идёт запись…',
        saved: 'Сохранено!',
        target: 'Целевая длительность',
        stopRecording: '⏹ Остановить запись',
        cancel: 'Отменить запись',
        permissionTitle: 'Нужен доступ к микрофону',
        permissionBody: 'Разрешите доступ к микрофону, чтобы записать свой звук для этого действия. Без этого будет использоваться звук по умолчанию.',
      },
      myAmbienceTooltip: 'Без ограничения по времени — записывайте сколько угодно. Звук зациклен без пауз.',
      slot: {
        kolobok: {
          roll: 'Качение',
          hop: 'Прыжок',
          songNote1: 'Мелодия без слов (до)',
          songNote2: 'Мелодия без слов (ре)',
          songNote3: 'Мелодия без слов (ми)',
          songNote4: 'Мелодия без слов (соль)',
          songNote5: 'Мелодия без слов (ля)',
          hum: 'Мурлыканье в пути',
          startled: 'Испуганный вздох',
          spin: 'Свист при развороте',
          landingSquash: 'Приземление',
          dustPuff: 'Облачко пыли',
          birthPop: 'Появление на свет',
          gulp: 'Глоток (поймала лиса)',
          giggle: 'Довольный смешок',
        },
        hare: {
          idleHop: 'Прыжок зайца на месте',
          sniff: 'Заяц принюхивается',
          startled: 'Заяц пугается',
        },
        wolf: {
          headSweep: 'Волк поводит головой',
          howl: 'Вой волка',
          snapMiss: 'Волк щёлкает зубами (мимо)',
        },
        bear: {
          scratch: 'Медведь чешется о дерево',
          grunt: 'Ворчание медведя',
          swipeMiss: 'Взмах лапы медведя (мимо)',
        },
        fox: {
          tailSway: 'Лиса помахивает хвостом',
          purr: 'Мурлыканье лисы',
          flatterCoo: 'Лиса воркует',
          lipLick: 'Лиса облизывается',
        },
        grandma: {
          hum: 'Бабушка напевает',
          tapReaction: 'Бабушка: «куда ты опять укатился?»',
          knitClick: 'Бабушка вяжет',
        },
        grandpa: {
          castLine: 'Дед закидывает удочку',
          catchCheer: 'Дед радуется улову',
          sighBoot: 'Дед вздыхает (сапог)',
        },
        owl: {
          hoot: 'Уханье совы',
        },
        hedgehog: {
          waddle: 'Топотание ежа',
          squeak: 'Писк ежа',
        },
        crow: {
          caw: 'Карканье вороны',
          wingFlap: 'Взмах крыльев вороны',
        },
        ridgeBird: {
          peck: 'Стук клювом по крыше',
        },
        bee: {
          buzz: 'Жужжание пчелы',
        },
        butterfly: {
          flutter: 'Порхание бабочки',
        },
        ambience: {
          wind: 'Ветер (фон)',
          rain: 'Дождь (фон)',
          thunder: 'Гром',
          pondRipple: 'Рябь на пруду',
          forestBirds: 'Лесные птицы (день)',
          nightCrickets: 'Сверчки (ночь)',
          izbaFire: 'Огонь в печи',
          leaves: 'Падающие листья',
        },
        ui: {
          tapBlip: 'Отклик на нажатие',
          plaqueBlip: 'Нажатие на указатель',
          menuOpen: 'Открытие меню',
          menuClose: 'Закрытие меню',
          playPause: 'Кнопка play/pause',
          eyeToggle: 'Переключатель камеры',
          langToggle: 'Переключатель языка',
          eggCounterTap: 'Нажатие на счётчик яиц',
          zoneSettle: 'Камера останавливается',
          narrationAppear: 'Появление текста',
        },
        egg: {
          fishSplash: 'Всплеск рыбки',
          bootThud: 'Стук сапога',
          goldSparkle: 'Блеск золотой рыбки',
          mushroomPop: 'Хлопок гриба',
          moonTwinkle: 'Мерцание луны',
          cloudDrizzle: 'Дождик из тучки',
        },
        chimney: {
          pipeClose: 'Закрытие трубы',
          bubbleRelease: 'Выпуск пузырей из трубы',
          bubbleShrink: 'Схлопывание пузыря',
        },
        nav: {
          crossroadsOpen: 'Открытие камня на распутье',
        },
        story: {
          doughAppear: 'Появление теста',
          windowGlowSwell: 'Свечение окна',
          fadeToBlack: 'Затемнение экрана',
          rebirthChime: 'Перезвон возрождения',
          loopTransition: 'Переход цикла',
        },
        dialogue: {
          kolobokSong: 'Колобок: «Я от бабушки ушёл...»',
          hareEat: 'Заяц: «Я тебя съем!»',
          wolfEat: 'Волк: «Я тебя съем!»',
          bearEat: 'Медведь: «Я тебя съем!»',
          foxFlatter: 'Лиса: «Какая славная песенка!..»',
          foxCloser: 'Лиса: «Сядь ко мне на носок...»',
          grandmaTap: 'Бабушка: «Куда укатился?»',
          bake1: 'Рассказчик: «Замесила бабушка тесто...»',
          bake1b: 'Рассказчик: «...скатала колобок»',
          bake2: 'Рассказчик: «...положила студиться...»',
          bragGrandma: 'Рассказчик: «От бабушки и дедушки...»',
          bragHare: 'Рассказчик: «От зайца ушёл...»',
          bragWolf: 'Рассказчик: «От волка ушёл...»',
          bragBear: 'Рассказчик: «От медведя ушёл...»',
          foxIntro: 'Рассказчик: «Кое-кто очень вежливый...»',
          snap: 'Рассказчик: «...ам!»',
          rebirth: 'Рассказчик: «Испекла нового.»',
          eggRebirth: 'Бабушка: «Только из печки!»',
        },
        myAmbience: {
          day: 'Моя дневная атмосфера',
          night: 'Моя ночная атмосфера',
        },
      },
    },
    weather: {
      permission: 'Разрешите доступ к геолокации — и небо над Колобком станет таким же, как у вас: рассвет, облака и даже снег.',
    },
    egg: {
      fish: 'Дед: «Ух ты, хороша! Ну, плыви себе.»',
      boot: 'Дед: «Опять сапог...»',
      goldfish: 'Дед: «Золотая рыбка! Отпущу тебя — нам и так хорошо.»',
    },
  },
};

/** expo-localization -> 'en' | 'ru'. Called once; result gets stored in
 *  sceneStore (see its `locale`/`setLocale`) so the rest of the app reads a
 *  reactive value instead of re-detecting. */
export function detectLocale() {
  const code = Localization.getLocales?.()[0]?.languageCode;
  return code === 'ru' ? 'ru' : 'en';
}

/** Dot-path lookup into STRINGS[locale], e.g. t('ui.menu.one', 'ru').
 *  Falls back to English, then to the raw key, so a missing translation
 *  degrades instead of crashing. */
export function t(key, locale = 'en') {
  const resolve = (table) => key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), table);
  return resolve(STRINGS[locale]) ?? resolve(STRINGS.en) ?? key;
}
