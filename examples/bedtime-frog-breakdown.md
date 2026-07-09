# Worked Example — "Pip and Posy: The Bedtime Frog"

Author/illustrator: Axel Scheffler. Publisher: Nosy Crow. ISBN 978-0-85763-115-2.

This is a HAND-BUILT version of exactly what the app's prep step should produce
for this book: OCR text + scene + cues per page. Use it during the session as
"known-correct output" to test milestone 3 (does Gemini produce something like
this?) and milestone 7 (does speech alignment fire on these trigger words?).

Character voice mapping for this book:
- Pip  = a boy rabbit  -> voice_child (calm/kind)
- Posy = a girl mouse   -> voice_child (but distinct; see note in LESSONS)
- Narrator text is NOT spoken by a character (see LESSONS: narration vs dialogue)

Legend: scene -> ambient_sound_id ; keyword -> fx id ; "quote" -> voice line

---

## p1 — COVER (skip for reading; use for title only)
ocr_text: "Pip and Posy — The Bedtime Frog. Axel Scheffler."
notes: Cover. prep should treat as title/cover, not a readable story page.

## p2 — TITLE PAGE (skip for reading)
ocr_text: "Pip and Posy — The Bedtime Frog. Axel Scheffler. Nosy Crow."
notes: Title page. No cues.

## p3
ocr_text: "Posy was going to stay at Pip's house."
scene: bedroom (daytime, cheerful) -> amb_indoors
keyword_cues: none strong
character_cues: none (pure narration)

## p4
ocr_text: "She packed up her suitcase very carefully. She didn't want to forget anything."
scene: bedroom -> amb_indoors
keyword_cues:
  - "packed" -> (soft) fx_zip / suitcase  [NOTE: not in starter library — see LESSONS]
character_cues: none (narration)
irony_note: "didn't want to forget anything" — she forgets Froggy. Not a sound cue,
  but a candidate for a future "story callback" feature (v2+).

## p5
ocr_text: "Then she got on the bus. She was very excited."
scene: street / bus -> amb_city
keyword_cues:
  - "bus" -> fx_engine (bus engine)  [maps OK to fx_engine]
character_cues: none (narration)
sign_text_note: image contains "Hoppy Holidays!" on the bus advert — decorative
  text, NOT story text. prep must NOT read incidental in-illustration text as
  story. (See LESSONS: incidental text.)

## p6
ocr_text: ""  (NO STORY TEXT ON THIS PAGE — illustration only)
scene: street / bus stop -> amb_city
notes: A page with art but no narrated text. prep must handle empty ocr_text
  gracefully (still allow an ambient bed; no keyword/character cues).

## p7
ocr_text: "Pip was really happy to see Posy. \"Hi, Posy!\" he called."
scene: street / outdoors town -> amb_city
keyword_cues:
  - "happy" -> (optional, soft) fx_none
character_cues:
  - Pip: "Hi, Posy!" -> voice_child  (trigger_text: "hi posy")
dialogue_note: mixes narration + one short quote. Only the quote is a voice cue.

## p8
ocr_text: "\"Hello, Pip!\" giggled Posy."
scene: outside house (garden, birds) -> amb_meadow (or amb_forest)
keyword_cues:
  - "giggled" -> fx_laugh
character_cues:
  - Posy: "Hello, Pip!" -> voice_child  (trigger_text: "hello pip")
overlap_note: "giggled" (effect) AND Posy's line (voice) are basically the same
  moment. prep/reader must handle two cues at one point without clashing. (LESSONS)

## p9
ocr_text: "Pip and Posy had lots of fun. They played with Pip's cars. They played with the farm."
scene: indoors, playing -> amb_indoors
keyword_cues:
  - "cars" -> fx_engine (toy car vroom)
  - "farm" -> fx_animal (farm animals)  [starter lib has fx_animal_dog/bird;
     a generic farm/animal sound is missing — see LESSONS]
character_cues: none (narration)

## p10
ocr_text: "And then they played a game called 'pirates in hospital'."
scene: indoors -> amb_indoors
keyword_cues: none strong (whimsical, no obvious SFX)
character_cues: none

## p11
ocr_text: "They ate spaghetti. They had a bubbly bath."
scene: indoors (kitchen + bathroom) -> amb_indoors
keyword_cues:
  - "bubbly bath" -> fx_splash / fx_pop (bubbles)
character_cues: none
two_scene_note: one page shows TWO activities (eating + bath). Single ambient is
  fine, but shows pages aren't always one clean scene. (LESSONS)

## p12
ocr_text: "They brushed their teeth. And they read a funny story. After that, it was time for bed."
scene: bathroom -> bedroom -> amb_indoors / amb_night
keyword_cues:
  - "brushed their teeth" -> (soft) fx_none
character_cues: none

## p13
ocr_text: "\"Night-night, Posy,\" said Pip, as he cuddled up with his piggy."
scene: bedroom, night, lamp -> amb_night
keyword_cues: none
character_cues:
  - Pip: "Night-night, Posy" -> voice_child

## p14
ocr_text: "\"Sweet dreams, Pip,\" said Posy. They switched off their lights."
scene: bedroom, night -> amb_night
keyword_cues:
  - "switched off their lights" -> fx_switch/click  [not in starter lib — LESSONS]
character_cues:
  - Posy: "Sweet dreams, Pip" -> voice_child

## p15
ocr_text: "Pip was very nearly asleep when he heard a voice. \"Froggy!\" said the voice."
scene: bedroom, night, quiet -> amb_night
keyword_cues:
  - "heard a voice" -> (mood) fx_none
character_cues:
  - (mystery) voice: "Froggy!" -> voice_child (it's Posy, revealed next page)
tension_note: gentle suspense; ambient should stay quiet/calm, not spooky.

## p16
ocr_text: "It was Posy. \"I've forgotten Froggy,\" she sniffed. \"I CAN'T SLEEP WITHOUT MY FROGGY!!\""
scene: bedroom, night -> amb_night
keyword_cues:
  - "sniffed" -> (soft) fx_none
character_cues:
  - Posy: "I've forgotten Froggy" -> voice_child (sad)
  - Posy: "I CAN'T SLEEP WITHOUT MY FROGGY!!" -> voice_child (LOUD/upset)
emphasis_note: ALL CAPS = louder/more emotional delivery. A cue could carry an
  intensity/emotion hint, not just which voice. (LESSONS: emotion/emphasis.)

## p17
ocr_text: "Pip turned his light back on again. \"Would you like this teddy, Posy?\" he said. But Posy did not want Pip's teddy. \"It's not green,\" she said. \"My frog is green.\""
scene: bedroom, night -> amb_night
keyword_cues:
  - "turned his light back on" -> fx_switch/click  [not in starter lib]
character_cues:
  - Pip: "Would you like this teddy, Posy?" -> voice_child
  - Posy: "It's not green," -> voice_child
  - Posy: "My frog is green." -> voice_child
multi_turn_note: 3 dialogue turns on ONE page, alternating speakers. Reader must
  fire the right voice at the right point in the text, in order. (LESSONS)

## p18
ocr_text: "\"Would you like my dinosaur?\" said Pip. \"He's green.\" \"No!\" said Posy. \"That dinosaur is too big and too scary!\""
scene: bedroom, night -> amb_night
keyword_cues:
  - "dinosaur" -> fx_roar  [not in starter lib — but very tempting for kids]
character_cues:
  - Pip: "Would you like my dinosaur? He's green." -> voice_child
  - Posy: "No! That dinosaur is too big and too scary!" -> voice_child

## p19
ocr_text: "\"What about my frog money box?\" said Pip. \"No!\" said Posy, \"That is the WRONG FROG!\""
scene: bedroom, night -> amb_night
character_cues:
  - Pip: "What about my frog money box?" -> voice_child
  - Posy: "No! That is the WRONG FROG!" -> voice_child (emphatic)

## p20
ocr_text: "Posy cried and cried and cried. Oh dear! Poor Posy."
scene: bedroom, night -> amb_night
keyword_cues:
  - "cried and cried and cried" -> fx_cry  [not in starter lib]
character_cues: none (narration; the crying is described, not quoted)
repetition_note: "cried and cried and cried" — repeated word. Speech alignment
  must not fire the same cue 3x awkwardly; treat the phrase as one trigger.

## p21
ocr_text: "Pip thought for a moment. Then he did a very difficult thing. \"Would you like Piggy, Posy?\" he said."
scene: bedroom/floor, night -> amb_night
character_cues:
  - Pip: "Would you like Piggy, Posy?" -> voice_child

## p22
ocr_text: "Posy stopped crying. Piggy was an extremely nice pig. \"Yes, please, Pip,\" she said."
scene: night -> amb_night
character_cues:
  - Posy: "Yes, please, Pip," -> voice_child (happy)

## p23
ocr_text: "Soon Pip was asleep."
scene: bedroom, night, sleeping -> amb_night
keyword_cues:
  - "asleep" -> (soft) fx_none / gentle snore?
character_cues: none

## p24
ocr_text: "And so was Posy."
scene: bedroom, night, sleeping -> amb_night
character_cues: none

## p25
ocr_text: "And the next day, when Posy went home to her house, she found her frog . . ."
scene: bedroom, daytime -> amb_indoors
character_cues: none
cliffhanger_note: trailing "..." continues onto next page. Page boundary splits
  one sentence. (LESSONS: sentences spanning pages.)

## p26
ocr_text: ". . . exactly where she had left him! Hooray!"
scene: bedroom, daytime, happy -> amb_indoors
keyword_cues:
  - "Hooray!" -> fx_cheer / fx_laugh
character_cues: none (narration exclamation)

## p27 — BACK COVER (skip for reading)
ocr_text: (blurb) "Posy has come to stay at Pip's house but just as they are
  going to bed, Posy realises that she has forgotten to pack her favourite frog
  toy! ... 'Full of comfort and gentle humour' The Guardian"
notes: Back cover / marketing copy. prep must NOT treat as a story page.
