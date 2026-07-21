# STRINGS.md — full EN/RU copy deck

Implement as `src/config/strings.js` exporting `{ en: {...}, ru: {...} }`
with dot-key lookup and a `t(key)` helper. Locale: `expo-localization`
`getLocales()[0].languageCode === 'ru'` → ru, else en. Store the resolved
locale in the zustand store; allow a dev override. ALL user-visible text in
the app must go through `t()` — no hardcoded strings in components.

Russian lines below use the traditional folk phrasing — do not "improve" them.

## Zone names
| key | en | ru |
|-----|----|----|
| zone.izba | Grandma's izba | Избушка бабушки |
| zone.hare | Hare meadow | Заячий луг |
| zone.wolf | Wolf forest | Волчий лес |
| zone.bear | Bear thicket | Медвежья чаща |
| zone.fox | Fox clearing | Лисья поляна |

## The song and animal lines (interactive encounters)
| key | en | ru |
|-----|----|----|
| song.full | "I ran away from Grandma, I ran away from Grandpa — and I'll run away from you!" | «Я от бабушки ушёл, я от дедушки ушёл — и от тебя уйду!» |
| line.eat.hare | Hare: "Kolobok, Kolobok, I will eat you up!" | Заяц: «Колобок, Колобок, я тебя съем!» |
| line.eat.wolf | Wolf: "Kolobok, Kolobok, I will eat you up!" | Волк: «Колобок, Колобок, я тебя съем!» |
| line.eat.bear | Bear: "Kolobok, Kolobok, I will eat you up!" | Медведь: «Колобок, Колобок, я тебя съем!» |
| line.fox.flatter | Fox: "What a lovely song! Come closer, dear — I can't quite hear." | Лиса: «Какая славная песенка! Подойди поближе, милый, — я стала глуховата.» |
| line.grandma.tap | Grandma: "Kolobok, where have you rolled off to again?" | Бабушка: «Колобок, куда ты опять укатился?» |

## Story mode narration (STORY_SPEC chapters)
| key | en | ru |
|-----|----|----|
| story.bake1 | Grandma scraped the flour bin and mixed a little dough... | По амбару метено, по сусекам скребено — замесила бабушка тесто... |
| story.bake1b | ...kneading and shaping it into a small round bun. | ...и скатала из него колобок. |
| story.bake2 | ...and set him on the windowsill to cool. But Kolobok had other plans. | ...и положила на окошко студиться. Но у Колобка были свои планы. |
| story.brag.grandma | And on he rolled — from Grandma and Grandpa he'd gotten away... | И покатился дальше — от бабушки ушёл, от дедушки ушёл... |
| story.brag.hare | And on he rolled — from the Hare he'd gotten away... | И покатился дальше — и от зайца ушёл... |
| story.brag.wolf | And on he rolled — from the Wolf he'd gotten away... | И покатился дальше — и от волка ушёл... |
| story.fox.intro | But by the fox clearing sat someone very polite... | А на лисьей поляне сидел кое-кто очень вежливый... |
| story.fox.closer | Fox: "Closer still, sweet thing... sit right on my nose." | Лиса: «Сядь ко мне на носок да спой ещё разок!» |
| story.snap | ...and SNAP! That is how the tale goes. | ...ам! — вот и сказке конец. |
| story.rebirth | But Grandma just smiled — and baked another. | А бабушка улыбнулась — и испекла нового. |
| story.egg.rebirth | Grandma: "Fresh out of the oven — again!" | Бабушка: «Только из печки — опять!» |

## UI copy
| key | en | ru |
|-----|----|----|
| ui.hint | Swipe to travel · tap a friend to say hello | Проведите пальцем — и в путь · нажмите на героя |
| ui.playTale | Play the tale | Рассказать сказку |
| ui.pauseTale | Pause the tale | Остановить сказку |
| ui.restartTale | Play the tale again | Рассказать сказку снова |
| ui.menu.one | PLACEHOLDER_MENU_1 | PLACEHOLDER_MENU_1 |
| ui.menu.two | PLACEHOLDER_MENU_2 | PLACEHOLDER_MENU_2 |
| ui.menu.three | PLACEHOLDER_MENU_3 | PLACEHOLDER_MENU_3 |
| weather.permission | Allow location so the sky above Kolobok matches yours — sunrise, clouds, even snow. | Разрешите доступ к геолокации — и небо над Колобком станет таким же, как у вас: рассвет, облака и даже снег. |
| ui.toggle3d | Show the fairytale scene | Показать сказочную сцену |
| ui.toggleFlat | Simple menu | Простое меню |

## Easter eggs
| key | en | ru |
|-----|----|----|
| egg.fish | Grandpa: "Ooh, a fine one! Back you go." | Дед: «Ух ты, хороша! Ну, плыви себе.» |
| egg.boot | Grandpa: "A boot. Again." | Дед: «Опять сапог...» |
| egg.goldfish | Grandpa: "A golden fish! I'll let you go, dear — no wishes needed today." | Дед: «Золотая рыбка! Отпущу тебя — нам и так хорошо.» |
| egg.fish.maslenitsa | Grandpa: "Fish today, pancakes tonight!" | Дед: «Рыбка к блинам — самое то!» |

## Sound, photo, holidays, badges
| key | en | ru |
|-----|----|----|
| ui.soundOn | Sound on | Включить звук |
| ui.soundOff | Sound off | Выключить звук |
| ui.photo | Photo | Фото |
| ui.badge.new | , {n} new | , {n} новых |
| story.rebirth.ny | ...and baked another. Happy New Year! | ...и испекла нового. С Новым годом! |

Menu labels are the only placeholders left in the whole package; the product
owner supplies three real labels + routes (see SPEC.md "Navigation").
Plaque text on the 3D stone renders these same keys (ART_SPEC §12) — keep
labels ≤ 14 characters per language or the plaque texture will truncate
with an ellipsis.
