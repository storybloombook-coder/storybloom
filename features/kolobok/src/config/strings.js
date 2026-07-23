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
