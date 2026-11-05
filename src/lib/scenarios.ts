// Scenario bank + session state for the scaffolded tutor (docs/tutor-methodology.md).
//
// The scenario is the deterministic half of the tutor: curated questions in a
// pedagogical order, an easier scaffold variant per question, deterministic
// reaction templates (the quality floor when the tiny model's micro-generation
// fails validation) and model-answer chips. The LLM only ever *upgrades* the
// reaction — it can never break the lesson structure.
//
// A1–A2 content note: every question is one short sentence in Present/Perfekt,
// one communicative function per turn, and the chips are the canonical answers
// the level expects ("Ich heiße …", "Ich komme aus …").

import type { Level } from '../types'
import { contentStems } from './parse'
import { TUTOR_TRANSITION, type TargetLang } from './langs'

/** Fixed UI-language translations of the deterministic reply parts */
export interface TrPair {
  ru: string
  en: string
}

export interface ScenarioTurn {
  /** canonical question the tutor asks at this step */
  question: string
  questionTr: TrPair
  /** easier variant with a choice — for short/empty answers */
  scaffold: string
  scaffoldTr: TrPair
  /** short re-ask variant, used after answering the student's own question */
  reask?: string
  reaskTr?: TrPair
  /** deterministic reaction templates by tone (the quality floor) */
  reactions: { positive: string; negative: string; short: string }
  /** canonical student answers for the chips */
  chips: [string, string, string]
  /** the tutor's own facts, for "und du?" questions */
  tutorFacts: string[]
}

export interface Scenario {
  id: string
  lang: TargetLang
  level: 'A1' | 'A2'
  title: string
  titleTr: TrPair
  /** keywords to match the sidebar topic field (lowercase) */
  keywords: string[]
  vocab: string[]
  turns: ScenarioTurn[]
}

export const SCENARIOS: Scenario[] = [
  // ---------- German ----------
  {
    id: 'de-a1-kennenlernen',
    lang: 'de',
    level: 'A1',
    title: 'Kennenlernen',
    titleTr: { ru: 'Знакомство', en: 'Getting to know each other' },
    keywords: ['kennenlern', 'знаком', 'знакомств', 'getName', 'имя', 'привет', 'hallo', 'guten tag', 'болтал'],
    vocab: ['heißen', 'kommen', 'wohnen', 'die Stadt', 'das Land', 'arbeiten', 'studieren', 'das Hobby'],
    turns: [
      {
        question: 'Wie heißt du?',
      questionTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        scaffold: 'Ich heiße Anna. Und du? Wie heißt du?',
      scaffoldTr: { ru: 'Меня зовут Анна. А тебя? Как тебя зовут?', en: 'My name is Anna. And you? What is your name?' },
        reask: 'Wie war noch mal dein Name?',
        reaskTr: { ru: 'Как ещё раз тебя зовут?', en: 'What was your name again?' },
        reactions: { positive: 'Hallo und willkommen!', negative: 'Hallo!', short: 'Hallo!' },
        chips: ['Ich heiße Sascha.', 'Mein Name ist Maria.', 'Ich heiße Alex.'],
        tutorFacts: ['Ich heiße Anna und ich bin deine Deutschlehrerin.'],
      },
      {
        question: 'Woher kommst du?',
      questionTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        scaffold: 'Ich komme aus Deutschland. Und du? Aus welchem Land kommst du?',
      scaffoldTr: { ru: 'Я из Германии. А ты? Из какой ты страны?', en: 'I am from Germany. And you? What country are you from?' },
        reask: 'Woher kommst du noch mal?',
        reaskTr: { ru: 'Откуда ты, ещё раз?', en: 'Where are you from, again?' },
        reactions: { positive: 'Schön, dich kennenzulernen!', negative: 'Schön, dich kennenzulernen!', short: 'Alles gut!' },
        chips: ['Ich komme aus Russland.', 'Ich komme aus Spanien.', 'Ich komme aus Deutschland.'],
        tutorFacts: ['Ich komme aus Deutschland, aus Berlin.'],
      },
      {
        question: 'Wo wohnst du jetzt?',
      questionTr: { ru: 'Где ты сейчас живёшь?', en: 'Where do you live now?' },
        scaffold: 'Ich wohne in Berlin. Und du? In welcher Stadt wohnst du?',
      scaffoldTr: { ru: 'Я живу в Берлине. А ты? В каком городе ты живёшь?', en: 'I live in Berlin. And you? What city do you live in?' },
        reask: 'Wo wohnst du?',
        reaskTr: { ru: 'Где ты живёшь?', en: 'Where do you live?' },
        reactions: { positive: 'Interessant!', negative: 'Alles gut!', short: 'Kein Problem!' },
        chips: ['Ich wohne in Moskau.', 'Ich wohne in einem kleinen Dorf.', 'Ich wohne bei meiner Familie.'],
        tutorFacts: ['Ich wohne in Berlin.'],
      },
      {
        question: 'Was machst du? Arbeit oder Studium?',
      questionTr: { ru: 'Чем ты занимаешься? Работа или учёба?', en: 'What do you do? Work or study?' },
        scaffold: 'Ich bin Sprachlehrerin. Und du? Was bist du von Beruf?',
      scaffoldTr: { ru: 'Я преподаватель языка. А ты? Кем ты работаешь?', en: 'I am a language teacher. And you? What is your job?' },
        reask: 'Und was machst du beruflich?',
        reaskTr: { ru: 'А кем ты работаешь?', en: 'And what is your job?' },
        reactions: { positive: 'Das klingt gut!', negative: 'Das ist okay!', short: 'Alles gut!' },
        chips: ['Ich bin Student.', 'Ich arbeite als Ingenieur.', 'Ich bin Lehrerin.'],
        tutorFacts: ['Ich bin Sprachlehrerin.'],
      },
      {
        question: 'Und was machst du gern in deiner Freizeit?',
      questionTr: { ru: 'А что ты любишь делать в свободное время?', en: 'And what do you like doing in your free time?' },
        scaffold: 'Ich lese gern Bücher. Und du? Was machst du gern?',
      scaffoldTr: { ru: 'Я люблю читать книги. А ты? Что ты любишь делать?', en: 'I like reading books. And you? What do you like to do?' },
        reask: 'Was ist dein Hobby?',
        reaskTr: { ru: 'Так какое у тебя хобби?', en: 'So what is your hobby?' },
        reactions: { positive: 'Das ist toll!', negative: 'Kein Problem!', short: 'Okay!' },
        chips: ['Ich spiele gern Fußball.', 'Ich lese gern.', 'Ich koche gern.'],
        tutorFacts: ['Ich höre gern Musik und lese Bücher.'],
      },
      {
        question: 'Erzähl mal: Was war letztes Wochenende?',
      questionTr: { ru: 'Расскажи-ка: как прошли прошлые выходные?', en: 'Tell me: how was your last weekend?' },
        scaffold: 'Ich war im Park. Und du? Was hast du am Wochenende gemacht?',
      scaffoldTr: { ru: 'Я была в парке. А ты? Что ты делал(а) на выходных?', en: 'I was in the park. And you? What did you do at the weekend?' },
        reask: 'Was hast du am Wochenende gemacht?',
        reaskTr: { ru: 'Что ты делал(а) на выходных?', en: 'What did you do at the weekend?' },
        reactions: { positive: 'Danke fürs Erzählen!', negative: 'Danke fürs Erzählen!', short: 'Okay!' },
        chips: ['Letztes Wochenende war ich zu Hause.', 'Ich habe einen Film gesehen.', 'Ich war mit Freunden essen.'],
        tutorFacts: ['Ich war letztes Wochenende im Park spazieren.'],
      },
    ],
  },
  {
    id: 'de-a1-fruehstueck',
    lang: 'de',
    level: 'A1',
    title: 'Frühstück',
    titleTr: { ru: 'Завтрак', en: 'Breakfast' },
    keywords: ['frühstück', 'fruhstuck', 'breakfast', 'завтрак', 'kaffee', 'coffee', 'кофе', 'essen', 'morgens', 'утро'],
    vocab: ['das Frühstück', 'der Kaffee', 'der Tee', 'die Milch', 'der Zucker', 'das Brötchen', 'der Käse', 'das Ei', 'lecker', 'mögen', 'essen', 'trinken'],
    turns: [
      {
        question: 'Trinkst du morgens Kaffee oder Tee?',
      questionTr: { ru: 'Ты пьёшь утром кофе или чай?', en: 'Do you drink coffee or tea in the morning?' },
        scaffold: 'Magst du Kaffee? Ja oder Nein?',
      scaffoldTr: { ru: 'Ты любишь кофе? Да или нет?', en: 'Do you like coffee? Yes or no?' },
        reask: 'Kaffee oder Tee — was trinkst du morgens?',
        reaskTr: { ru: 'Кофе или чай — что ты пьёшь утром?', en: 'Coffee or tea — what do you drink in the morning?' },
        reactions: { positive: 'Guten Morgen! Schön, dass du da bist.', negative: 'Guten Morgen!', short: 'Guten Morgen!' },
        chips: ['Ich trinke Kaffee.', 'Ich trinke Tee.', 'Ich trinke morgens nichts.'],
        tutorFacts: ['Ich trinke morgens immer Kaffee.'],
      },
      {
        question: 'Mit Milch und Zucker?',
      questionTr: { ru: 'С молоком и сахаром?', en: 'With milk and sugar?' },
        scaffold: 'Ich trinke Kaffee mit Milch. Und du? Mit Milch?',
      scaffoldTr: { ru: 'Я пью кофе с молоком. А ты? С молоком?', en: 'I drink coffee with milk. And you? With milk?' },
        reask: 'Mit Milch und Zucker?',
        reaskTr: { ru: 'С молоком и сахаром?', en: 'With milk and sugar?' },
        reactions: { positive: 'So trinke ich meinen Kaffee auch!', negative: 'Alles gut, jeder trinkt anders.', short: 'Alles gut!' },
        chips: ['Mit Milch, ohne Zucker.', 'Ohne Milch, mit Zucker.', 'Nur schwarz, danke.'],
        tutorFacts: ['Ich trinke Kaffee mit Milch und ein bisschen Zucker.'],
      },
      {
        question: 'Was isst du zum Frühstück?',
      questionTr: { ru: 'Что ты ешь на завтрак?', en: 'What do you eat for breakfast?' },
        scaffold: 'Ich esse ein Brötchen mit Käse. Und du? Brot oder Brötchen?',
      scaffoldTr: { ru: 'Я ем булочку с сыром. А ты? Хлеб или булочку?', en: 'I eat a roll with cheese. And you? Bread or a roll?' },
        reask: 'Was isst du zum Frühstück?',
        reaskTr: { ru: 'Что ты ешь на завтрак?', en: 'What do you eat for breakfast?' },
        reactions: { positive: 'Das klingt lecker!', negative: 'Alles gut!', short: 'Kein Problem!' },
        chips: ['Ich esse ein Brötchen mit Käse.', 'Ich esse Brot mit Marmelade.', 'Ich esse ein Ei.'],
        tutorFacts: ['Ich esse gern ein Brötchen mit Käse.'],
      },
      {
        question: 'Und was ist dein Lieblingsfrühstück?',
      questionTr: { ru: 'А какой у тебя любимый завтрак?', en: 'And what is your favourite breakfast?' },
        scaffold: 'Mein Lieblingsfrühstück ist Brötchen mit Käse. Und deins?',
      scaffoldTr: { ru: 'Мой любимый завтрак — булочка с сыром. А твой?', en: 'My favourite breakfast is a roll with cheese. And yours?' },
        reask: 'Was ist dein Lieblingsfrühstück?',
        reaskTr: { ru: 'Какой у тебя любимый завтрак?', en: 'What is your favourite breakfast?' },
        reactions: { positive: 'Mmh, sehr gut!', negative: 'Interessant!', short: 'Okay!' },
        chips: ['Mein Lieblingsfrühstück ist Brot mit Käse.', 'Ich liebe Pancakes.', 'Ich esse am liebsten Eier.'],
        tutorFacts: ['Mein Lieblingsfrühstück ist ein Brötchen mit Käse und Kaffee.'],
      },
      {
        question: 'Frühstückst du jeden Tag oder nur am Wochenende?',
      questionTr: { ru: 'Ты завтракаешь каждый день или только по выходным?', en: 'Do you have breakfast every day or only at the weekend?' },
        scaffold: 'Ich frühstücke jeden Tag. Und du? Jeden Tag oder nur am Wochenende?',
      scaffoldTr: { ru: 'Я завтракаю каждый день. А ты? Каждый день или только по выходным?', en: 'I have breakfast every day. And you? Every day or only at the weekend?' },
        reask: 'Frühstückst du jeden Tag?',
        reaskTr: { ru: 'Ты завтракаешь каждый день?', en: 'Do you have breakfast every day?' },
        reactions: { positive: 'Sehr gut!', negative: 'Am Wochenende ist Zeit für ein schönes Frühstück!', short: 'Alles gut!' },
        chips: ['Ich frühstücke jeden Tag.', 'Nur am Wochenende.', 'Unter der Woche habe ich keine Zeit.'],
        tutorFacts: ['Ich frühstücke jeden Tag, auch unter der Woche.'],
      },
    ],
  },
  {
    id: 'de-a1-hobby',
    lang: 'de',
    level: 'A1',
    title: 'Mein Hobby',
    titleTr: { ru: 'Моё хобби', en: 'My hobby' },
    keywords: ['hobby', 'freizeit', 'футбол', 'fußball', 'football', 'хобби', 'interest', 'musik', 'музыка', 'спорт', 'sport', 'lesen'],
    vocab: ['das Hobby', 'die Freizeit', 'spielen', 'machen', 'gern', 'oft', 'das Wochenende', 'spannend', 'entspannen'],
    turns: [
      {
        question: 'Welches Hobby hast du?',
      questionTr: { ru: 'Какое у тебя хобби?', en: 'What is your hobby?' },
        scaffold: 'Ich male gern. Und du? Sport, Musik oder etwas anderes?',
      scaffoldTr: { ru: 'Я люблю рисовать. А ты? Спорт, музыка или что-то другое?', en: 'I like painting. And you? Sport, music or something else?' },
        reask: 'Was ist dein Hobby?',
        reaskTr: { ru: 'Какое у тебя хобби?', en: 'What is your hobby?' },
        reactions: { positive: 'Super, lass uns über Hobbys sprechen!', negative: 'Hallo!', short: 'Hallo!' },
        chips: ['Mein Hobby ist Fußball.', 'Ich male gern.', 'Ich spiele Gitarre.'],
        tutorFacts: ['Ich koche gern und gehe spazieren.'],
      },
      {
        question: 'Wie oft machst du das?',
      questionTr: { ru: 'Как часто ты этим занимаешься?', en: 'How often do you do it?' },
        scaffold: 'Ich koche jeden Tag. Und du? Einmal pro Woche oder öfter?',
      scaffoldTr: { ru: 'Я готовлю каждый день. А ты? Раз в неделю или чаще?', en: 'I cook every day. And you? Once a week or more often?' },
        reask: 'Wie oft machst du dein Hobby?',
        reaskTr: { ru: 'Как часто ты занимаешься хобби?', en: 'How often do you do your hobby?' },
        reactions: { positive: 'Das ist ein schönes Hobby!', negative: 'Das ist okay!', short: 'Kein Problem!' },
        chips: ['Einmal pro Woche.', 'Jeden Tag.', 'Nur am Wochenende.'],
        tutorFacts: ['Ich koche fast jeden Tag.'],
      },
      {
        question: 'Warum macht dir das Spaß?',
      questionTr: { ru: 'Почему тебе это нравится?', en: 'Why is it fun for you?' },
        scaffold: 'Ich koche gern, weil es lecker ist. Und du? Warum macht dir dein Hobby Spaß?',
      scaffoldTr: { ru: 'Я люблю готовить, потому что это вкусно. А ты? Почему тебе нравится твоё хобби?', en: 'I like cooking because it is tasty. And you? Why is your hobby fun?' },
        reask: 'Warum magst du dein Hobby?',
        reaskTr: { ru: 'Почему тебе нравится твоё хобби?', en: 'Why do you like your hobby?' },
        reactions: { positive: 'Verstehe, das klingt gut!', negative: 'Verstehe!', short: 'Alles gut!' },
        chips: ['Weil es spannend ist.', 'Weil ich mit Freunden bin.', 'Weil ich mich entspanne.'],
        tutorFacts: ['Ich koche gern, weil ich gutes Essen liebe.'],
      },
      {
        question: 'Bist du gut in deinem Hobby?',
      questionTr: { ru: 'У тебя это хорошо получается?', en: 'Are you good at your hobby?' },
        scaffold: 'Ich koche ziemlich gut. Und du? Bist du gut?',
      scaffoldTr: { ru: 'Я готовлю довольно хорошо. А ты? У тебя хорошо получается?', en: 'I cook quite well. And you? Are you good at it?' },
        reask: 'Bist du gut in deinem Hobby?',
        reaskTr: { ru: 'У тебя это хорошо получается?', en: 'Are you good at your hobby?' },
        reactions: { positive: 'Das ist wirklich interessant!', negative: 'Kein Problem, Übung macht den Meister!', short: 'Okay!' },
        chips: ['Ja, ich bin sehr gut.', 'Ein bisschen.', 'Nein, aber es macht Spaß.'],
        tutorFacts: ['Ich bin ziemlich gut im Kochen.'],
      },
      {
        question: 'Was machst du am Wochenende mit deinem Hobby?',
      questionTr: { ru: 'Чем ты занимаешься своим хобби на выходных?', en: 'What do you do with your hobby at the weekend?' },
        scaffold: 'Am Wochenende koche ich für Freunde. Und du?',
      scaffoldTr: { ru: 'На выходных я готовлю для друзей. А ты?', en: 'At the weekend I cook for friends. And you?' },
        reask: 'Was machst du am Wochenende?',
        reaskTr: { ru: 'Что ты делаешь на выходных?', en: 'What do you do at the weekend?' },
        reactions: { positive: 'Sehr schön!', negative: 'Alles gut!', short: 'Okay!' },
        chips: ['Am Wochenende spiele ich mit Freunden.', 'Ich habe am Wochenende mehr Zeit.', 'Am Wochenende trainiere ich.'],
        tutorFacts: ['Am Wochenende koche ich für meine Freunde.'],
      },
    ],
  },
  {
    id: 'de-a2-wochenende',
    lang: 'de',
    level: 'A2',
    title: 'Am Wochenende',
    titleTr: { ru: 'На выходных', en: 'At the weekend' },
    keywords: ['wochenende', 'weekend', 'выходн', 'vergangen', 'past', 'прошедш', 'ferien', 'urlaub', 'отпуск', 'план', 'plan'],
    vocab: ['das Wochenende', 'machen', 'sehen', 'gehen', 'essen', 'besuchen', 'zuerst', 'danach', 'letztes Wochenende', 'nächstes Wochenende'],
    turns: [
      {
        question: 'Was hast du am Wochenende gemacht?',
      questionTr: { ru: 'Что ты делал(а) на выходных?', en: 'What did you do at the weekend?' },
        scaffold: 'Ich war im Kino. Und du? Was hast du gemacht?',
      scaffoldTr: { ru: 'Я была в кино. А ты? Что ты делал(а)?', en: 'I was at the cinema. And you? What did you do?' },
        reask: 'Was hast du am Wochenende gemacht?',
        reaskTr: { ru: 'Что ты делал(а) на выходных?', en: 'What did you do at the weekend?' },
        reactions: { positive: 'Schön, dass du da bist!', negative: 'Hallo!', short: 'Hallo!' },
        chips: ['Ich habe einen Film gesehen.', 'Ich bin mit Freunden spazieren gegangen.', 'Ich war zu Hause.'],
        tutorFacts: ['Ich war am Wochenende im Park und habe ein Buch gelesen.'],
      },
      {
        question: 'Und wie war es? Erzähl mal!',
      questionTr: { ru: 'И как? Расскажи!', en: 'And how was it? Tell me!' },
        scaffold: 'Es war schön bei mir. Und bei dir? Gut oder langweilig?',
      scaffoldTr: { ru: 'У меня было хорошо. А у тебя? Хорошо или скучно?', en: 'It was nice for me. And for you? Good or boring?' },
        reask: 'Wie war dein Wochenende?',
        reaskTr: { ru: 'Как прошли твои выходные?', en: 'How was your weekend?' },
        reactions: { positive: 'Das klingt nach einem schönen Wochenende!', negative: 'Manchmal ist ein ruhiges Wochenende auch gut.', short: 'Alles gut!' },
        chips: ['Es war sehr schön.', 'Es war langweilig.', 'Es war lustig.'],
        tutorFacts: ['Mein Wochenende war ruhig und schön.'],
      },
      {
        question: 'Was hast du danach gemacht?',
      questionTr: { ru: 'Что ты делал(а) потом?', en: 'What did you do afterwards?' },
        scaffold: 'Danach habe ich Kaffee getrunken. Und du?',
      scaffoldTr: { ru: 'Потом я выпила кофе. А ты?', en: 'Afterwards I had a coffee. And you?' },
        reask: 'Was hast du danach gemacht?',
        reaskTr: { ru: 'Что ты делал(а) потом?', en: 'What did you do afterwards?' },
        reactions: { positive: 'Interessant, weiter so!', negative: 'Verstehe!', short: 'Okay!' },
        chips: ['Danach habe ich Pizza gegessen.', 'Danach bin ich nach Hause gegangen.', 'Danach habe ich lange geschlafen.'],
        tutorFacts: ['Danach habe ich noch einen Kaffee getrunken.'],
      },
      {
        question: 'Was machst du nächstes Wochenende?',
      questionTr: { ru: 'Что ты будешь делать в следующие выходные?', en: 'What are you doing next weekend?' },
        scaffold: 'Ich besuche meine Eltern. Und du? Bleibst du zu Hause?',
      scaffoldTr: { ru: 'Я навещу родителей. А ты? Останешься дома?', en: 'I am visiting my parents. And you? Are you staying at home?' },
        reask: 'Was sind deine Pläne für nächstes Wochenende?',
        reaskTr: { ru: 'Какие у тебя планы на следующие выходные?', en: 'What are your plans for next weekend?' },
        reactions: { positive: 'Danke fürs Erzählen!', negative: 'Danke fürs Erzählen!', short: 'Okay!' },
        chips: ['Nächstes Wochenende besuche ich meine Eltern.', 'Ich bleibe zu Hause.', 'Ich fahre ans Meer.'],
        tutorFacts: ['Nächstes Wochenende besuche ich meine Schwester.'],
      },
    ],
  },

  // ---------- English (ports of the German A1/A2 packs) ----------
  {
    id: 'en-a1-getting-to-know',
    lang: 'en',
    level: 'A1',
    title: 'Getting to know each other',
    titleTr: { ru: 'Знакомство', en: 'Getting to know each other' },
    keywords: ['getting to know', 'знакомств', 'имя', 'name', 'hello', 'hi', 'привет'],
    vocab: ['name', 'come from', 'live', 'city', 'country', 'work', 'study', 'free time'],
    turns: [
      {
        question: 'What is your name?',
        questionTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        scaffold: 'My name is Anna. And you? What is your name?',
        scaffoldTr: { ru: 'Меня зовут Анна. А тебя? Как тебя зовут?', en: 'My name is Anna. And you? What is your name?' },
        reask: 'What was your name again?',
        reaskTr: { ru: 'Как ещё раз тебя зовут?', en: 'What was your name again?' },
        reactions: { positive: 'Hello and welcome!', negative: 'Hello!', short: 'Hello!' },
        chips: ['My name is Sasha.', "I'm Maria.", 'You can call me Alex.'],
        tutorFacts: ['My name is Anna and I am your English tutor.'],
      },
      {
        question: 'Where are you from?',
        questionTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        scaffold: 'I am from the UK. And you? What country are you from?',
        scaffoldTr: { ru: 'Я из Великобритании. А ты? Из какой ты страны?', en: 'I am from the UK. And you? What country are you from?' },
        reask: 'Where are you from, again?',
        reaskTr: { ru: 'Откуда ты, ещё раз?', en: 'Where are you from, again?' },
        reactions: { positive: 'Nice to meet you!', negative: 'Nice to meet you!', short: "That's okay!" },
        chips: ["I'm from Russia.", "I'm from Spain.", "I'm from Germany."],
        tutorFacts: ['I am from the UK, from London.'],
      },
      {
        question: 'Where do you live now?',
        questionTr: { ru: 'Где ты сейчас живёшь?', en: 'Where do you live now?' },
        scaffold: 'I live in London. And you? What city do you live in?',
        scaffoldTr: { ru: 'Я живу в Лондоне. А ты? В каком городе ты живёшь?', en: 'I live in London. And you? What city do you live in?' },
        reask: 'Where do you live?',
        reaskTr: { ru: 'Где ты живёшь?', en: 'Where do you live?' },
        reactions: { positive: 'Interesting!', negative: "That's okay!", short: 'No problem!' },
        chips: ['I live in Moscow.', 'I live in a small village.', 'I live with my family.'],
        tutorFacts: ['I live in London.'],
      },
      {
        question: 'What do you do? Work or study?',
        questionTr: { ru: 'Чем ты занимаешься? Работа или учёба?', en: 'What do you do? Work or study?' },
        scaffold: 'I am a language teacher. And you? What is your job?',
        scaffoldTr: { ru: 'Я преподаватель языка. А ты? Кем ты работаешь?', en: 'I am a language teacher. And you? What is your job?' },
        reask: 'And what is your job?',
        reaskTr: { ru: 'А кем ты работаешь?', en: 'And what is your job?' },
        reactions: { positive: 'That sounds good!', negative: "That's okay!", short: "That's okay!" },
        chips: ["I'm a student.", 'I work as an engineer.', "I'm a teacher."],
        tutorFacts: ['I am a language teacher.'],
      },
      {
        question: 'And what do you like doing in your free time?',
        questionTr: { ru: 'А что ты любишь делать в свободное время?', en: 'And what do you like doing in your free time?' },
        scaffold: 'I like reading books. And you? What do you like to do?',
        scaffoldTr: { ru: 'Я люблю читать книги. А ты? Что ты любишь делать?', en: 'I like reading books. And you? What do you like to do?' },
        reask: 'So what is your hobby?',
        reaskTr: { ru: 'Так какое у тебя хобби?', en: 'So what is your hobby?' },
        reactions: { positive: "That's great!", negative: 'No problem!', short: 'Okay!' },
        chips: ['I like playing football.', 'I like reading.', 'I like cooking.'],
        tutorFacts: ['I like listening to music and reading books.'],
      },
      {
        question: 'Tell me: how was your last weekend?',
        questionTr: { ru: 'Расскажи-ка: как прошли прошлые выходные?', en: 'Tell me: how was your last weekend?' },
        scaffold: 'I was in the park. And you? What did you do at the weekend?',
        scaffoldTr: { ru: 'Я была в парке. А ты? Что ты делал(а) на выходных?', en: 'I was in the park. And you? What did you do at the weekend?' },
        reask: 'What did you do at the weekend?',
        reaskTr: { ru: 'Что ты делал(а) на выходных?', en: 'What did you do at the weekend?' },
        reactions: { positive: 'Thanks for sharing!', negative: 'Thanks for sharing!', short: 'Okay!' },
        chips: ['Last weekend I was at home.', 'I watched a film.', 'I went out with friends.'],
        tutorFacts: ['Last weekend I went for a walk in the park.'],
      },
    ],
  },
  {
    id: 'en-a1-breakfast',
    lang: 'en',
    level: 'A1',
    title: 'Breakfast',
    titleTr: { ru: 'Завтрак', en: 'Breakfast' },
    keywords: ['breakfast', 'завтрак', 'coffee', 'кофе', 'tea', 'чай', 'morning', 'утро', 'eat'],
    vocab: ['breakfast', 'coffee', 'tea', 'milk', 'sugar', 'roll', 'cheese', 'egg', 'tasty', 'like', 'eat', 'drink'],
    turns: [
      {
        question: 'Do you drink coffee or tea in the morning?',
        questionTr: { ru: 'Ты пьёшь утром кофе или чай?', en: 'Do you drink coffee or tea in the morning?' },
        scaffold: 'Do you like coffee? Yes or no?',
        scaffoldTr: { ru: 'Ты любишь кофе? Да или нет?', en: 'Do you like coffee? Yes or no?' },
        reask: 'Coffee or tea — what do you drink in the morning?',
        reaskTr: { ru: 'Кофе или чай — что ты пьёшь утром?', en: 'Coffee or tea — what do you drink in the morning?' },
        reactions: { positive: 'Good morning! Great that you are here.', negative: 'Good morning!', short: 'Good morning!' },
        chips: ['I drink coffee.', 'I drink tea.', "I don't drink anything in the morning."],
        tutorFacts: ['I always drink coffee in the morning.'],
      },
      {
        question: 'With milk and sugar?',
        questionTr: { ru: 'С молоком и сахаром?', en: 'With milk and sugar?' },
        scaffold: 'I drink coffee with milk. And you? With milk?',
        scaffoldTr: { ru: 'Я пью кофе с молоком. А ты? С молоком?', en: 'I drink coffee with milk. And you? With milk?' },
        reask: 'With milk and sugar?',
        reaskTr: { ru: 'С молоком и сахаром?', en: 'With milk and sugar?' },
        reactions: { positive: "That's how I drink my coffee too!", negative: "That's fine, everyone drinks it differently.", short: "That's fine!" },
        chips: ['With milk, no sugar.', 'No milk, with sugar.', 'Just black, thanks.'],
        tutorFacts: ['I drink coffee with milk and a little sugar.'],
      },
      {
        question: 'What do you eat for breakfast?',
        questionTr: { ru: 'Что ты ешь на завтрак?', en: 'What do you eat for breakfast?' },
        scaffold: 'I eat a roll with cheese. And you? Bread or a roll?',
        scaffoldTr: { ru: 'Я ем булочку с сыром. А ты? Хлеб или булочку?', en: 'I eat a roll with cheese. And you? Bread or a roll?' },
        reask: 'What do you eat for breakfast?',
        reaskTr: { ru: 'Что ты ешь на завтрак?', en: 'What do you eat for breakfast?' },
        reactions: { positive: 'That sounds tasty!', negative: "That's fine!", short: 'No problem!' },
        chips: ['I eat a roll with cheese.', 'I eat bread with jam.', 'I have an egg.'],
        tutorFacts: ['I like to eat a roll with cheese.'],
      },
      {
        question: 'And what is your favourite breakfast?',
        questionTr: { ru: 'А какой у тебя любимый завтрак?', en: 'And what is your favourite breakfast?' },
        scaffold: 'My favourite breakfast is a roll with cheese. And yours?',
        scaffoldTr: { ru: 'Мой любимый завтрак — булочка с сыром. А твой?', en: 'My favourite breakfast is a roll with cheese. And yours?' },
        reask: 'What is your favourite breakfast?',
        reaskTr: { ru: 'Какой у тебя любимый завтрак?', en: 'What is your favourite breakfast?' },
        reactions: { positive: 'Mmm, very nice!', negative: 'Interesting!', short: 'Okay!' },
        chips: ['My favourite breakfast is bread and cheese.', 'I love pancakes.', 'I like eggs best.'],
        tutorFacts: ['My favourite breakfast is a roll with cheese and coffee.'],
      },
      {
        question: 'Do you have breakfast every day or only at the weekend?',
        questionTr: { ru: 'Ты завтракаешь каждый день или только по выходным?', en: 'Do you have breakfast every day or only at the weekend?' },
        scaffold: 'I have breakfast every day. And you? Every day or only at the weekend?',
        scaffoldTr: { ru: 'Я завтракаю каждый день. А ты? Каждый день или только по выходным?', en: 'I have breakfast every day. And you? Every day or only at the weekend?' },
        reask: 'Do you have breakfast every day?',
        reaskTr: { ru: 'Ты завтракаешь каждый день?', en: 'Do you have breakfast every day?' },
        reactions: { positive: 'Very good!', negative: 'The weekend is a nice time for a big breakfast!', short: "That's fine!" },
        chips: ['I have breakfast every day.', 'Only at the weekend.', 'During the week I have no time.'],
        tutorFacts: ['I have breakfast every day, even during the week.'],
      },
    ],
  },
  {
    id: 'en-a1-hobby',
    lang: 'en',
    level: 'A1',
    title: 'My hobby',
    titleTr: { ru: 'Моё хобби', en: 'My hobby' },
    keywords: ['hobby', 'футбол', 'football', 'хобби', 'interest', 'music', 'музыка', 'спорт', 'sport', 'reading'],
    vocab: ['hobby', 'free time', 'play', 'do', 'like', 'often', 'weekend', 'exciting', 'relax'],
    turns: [
      {
        question: 'What is your hobby?',
        questionTr: { ru: 'Какое у тебя хобби?', en: 'What is your hobby?' },
        scaffold: 'I like painting. And you? Sport, music or something else?',
        scaffoldTr: { ru: 'Я люблю рисовать. А ты? Спорт, музыка или что-то другое?', en: 'I like painting. And you? Sport, music or something else?' },
        reask: 'What is your hobby?',
        reaskTr: { ru: 'Какое у тебя хобби?', en: 'What is your hobby?' },
        reactions: { positive: 'Great, let us talk about hobbies!', negative: 'Hello!', short: 'Hello!' },
        chips: ['My hobby is football.', 'I like painting.', 'I play the guitar.'],
        tutorFacts: ['I like cooking and going for walks.'],
      },
      {
        question: 'How often do you do it?',
        questionTr: { ru: 'Как часто ты этим занимаешься?', en: 'How often do you do it?' },
        scaffold: 'I cook every day. And you? Once a week or more often?',
        scaffoldTr: { ru: 'Я готовлю каждый день. А ты? Раз в неделю или чаще?', en: 'I cook every day. And you? Once a week or more often?' },
        reask: 'How often do you do your hobby?',
        reaskTr: { ru: 'Как часто ты занимаешься хобби?', en: 'How often do you do your hobby?' },
        reactions: { positive: 'That is a nice hobby!', negative: "That's okay!", short: 'No problem!' },
        chips: ['Once a week.', 'Every day.', 'Only at the weekend.'],
        tutorFacts: ['I cook almost every day.'],
      },
      {
        question: 'Why is it fun for you?',
        questionTr: { ru: 'Почему тебе это нравится?', en: 'Why is it fun for you?' },
        scaffold: 'I like cooking because it is tasty. And you? Why is your hobby fun?',
        scaffoldTr: { ru: 'Я люблю готовить, потому что это вкусно. А ты? Почему тебе нравится твоё хобби?', en: 'I like cooking because it is tasty. And you? Why is your hobby fun?' },
        reask: 'Why do you like your hobby?',
        reaskTr: { ru: 'Почему тебе нравится твоё хобби?', en: 'Why do you like your hobby?' },
        reactions: { positive: 'I see, that sounds good!', negative: 'I see!', short: "That's okay!" },
        chips: ['Because it is exciting.', 'Because I am with friends.', 'Because I relax.'],
        tutorFacts: ['I like cooking because I love good food.'],
      },
      {
        question: 'Are you good at your hobby?',
        questionTr: { ru: 'У тебя это хорошо получается?', en: 'Are you good at your hobby?' },
        scaffold: 'I cook quite well. And you? Are you good at it?',
        scaffoldTr: { ru: 'Я готовлю довольно хорошо. А ты? У тебя хорошо получается?', en: 'I cook quite well. And you? Are you good at it?' },
        reask: 'Are you good at your hobby?',
        reaskTr: { ru: 'У тебя это хорошо получается?', en: 'Are you good at your hobby?' },
        reactions: { positive: 'That is really interesting!', negative: 'No problem, practice makes perfect!', short: 'Okay!' },
        chips: ['Yes, I am very good.', 'A little.', 'No, but it is fun.'],
        tutorFacts: ['I am quite good at cooking.'],
      },
      {
        question: 'What do you do with your hobby at the weekend?',
        questionTr: { ru: 'Чем ты занимаешься своим хобби на выходных?', en: 'What do you do with your hobby at the weekend?' },
        scaffold: 'At the weekend I cook for friends. And you?',
        scaffoldTr: { ru: 'На выходных я готовлю для друзей. А ты?', en: 'At the weekend I cook for friends. And you?' },
        reask: 'What do you do at the weekend?',
        reaskTr: { ru: 'Что ты делаешь на выходных?', en: 'What do you do at the weekend?' },
        reactions: { positive: 'Very nice!', negative: "That's fine!", short: 'Okay!' },
        chips: ['At the weekend I play with friends.', 'I have more time at the weekend.', 'I train at the weekend.'],
        tutorFacts: ['At the weekend I cook for my friends.'],
      },
    ],
  },
  {
    id: 'en-a2-weekend',
    lang: 'en',
    level: 'A2',
    title: 'At the weekend',
    titleTr: { ru: 'На выходных', en: 'At the weekend' },
    keywords: ['weekend', 'выходн', 'past', 'прошедш', 'holiday', 'отпуск', 'plan', 'план'],
    vocab: ['weekend', 'do', 'see', 'go', 'eat', 'visit', 'first', 'afterwards', 'last weekend', 'next weekend'],
    turns: [
      {
        question: 'What did you do at the weekend?',
        questionTr: { ru: 'Что ты делал(а) на выходных?', en: 'What did you do at the weekend?' },
        scaffold: 'I was at the cinema. And you? What did you do?',
        scaffoldTr: { ru: 'Я была в кино. А ты? Что ты делал(а)?', en: 'I was at the cinema. And you? What did you do?' },
        reask: 'What did you do at the weekend?',
        reaskTr: { ru: 'Что ты делал(а) на выходных?', en: 'What did you do at the weekend?' },
        reactions: { positive: 'Nice that you are here!', negative: 'Hello!', short: 'Hello!' },
        chips: ['I watched a film.', 'I went for a walk with friends.', 'I was at home.'],
        tutorFacts: ['At the weekend I was in the park and read a book.'],
      },
      {
        question: 'And how was it? Tell me!',
        questionTr: { ru: 'И как? Расскажи!', en: 'And how was it? Tell me!' },
        scaffold: 'It was nice for me. And for you? Good or boring?',
        scaffoldTr: { ru: 'У меня было хорошо. А у тебя? Хорошо или скучно?', en: 'It was nice for me. And for you? Good or boring?' },
        reask: 'How was your weekend?',
        reaskTr: { ru: 'Как прошли твои выходные?', en: 'How was your weekend?' },
        reactions: { positive: 'That sounds like a lovely weekend!', negative: 'Sometimes a quiet weekend is good too.', short: "That's fine!" },
        chips: ['It was very nice.', 'It was boring.', 'It was funny.'],
        tutorFacts: ['My weekend was quiet and nice.'],
      },
      {
        question: 'What did you do afterwards?',
        questionTr: { ru: 'Что ты делал(а) потом?', en: 'What did you do afterwards?' },
        scaffold: 'Afterwards I had a coffee. And you?',
        scaffoldTr: { ru: 'Потом я выпила кофе. А ты?', en: 'Afterwards I had a coffee. And you?' },
        reask: 'What did you do afterwards?',
        reaskTr: { ru: 'Что ты делал(а) потом?', en: 'What did you do afterwards?' },
        reactions: { positive: 'Interesting, keep going!', negative: 'I see!', short: 'Okay!' },
        chips: ['Afterwards I ate pizza.', 'Afterwards I went home.', 'Afterwards I slept for a long time.'],
        tutorFacts: ['Afterwards I had another coffee.'],
      },
      {
        question: 'What are you doing next weekend?',
        questionTr: { ru: 'Что ты будешь делать в следующие выходные?', en: 'What are you doing next weekend?' },
        scaffold: 'I am visiting my parents. And you? Are you staying at home?',
        scaffoldTr: { ru: 'Я навещу родителей. А ты? Останешься дома?', en: 'I am visiting my parents. And you? Are you staying at home?' },
        reask: 'What are your plans for next weekend?',
        reaskTr: { ru: 'Какие у тебя планы на следующие выходные?', en: 'What are your plans for next weekend?' },
        reactions: { positive: 'Thanks for sharing!', negative: 'Thanks for sharing!', short: 'Okay!' },
        chips: ['Next weekend I am visiting my parents.', 'I am staying at home.', 'I am going to the sea.'],
        tutorFacts: ['Next weekend I am visiting my sister.'],
      },
    ],
  },

  // ---------- Russian (Piper voice) ----------
  {
    id: 'ru-a1-znakomstvo',
    lang: 'ru',
    level: 'A1',
    title: 'Знакомство',
    titleTr: { ru: 'Знакомство', en: 'Getting to know each other' },
    keywords: ['знакомств', 'имя', 'привет', 'здравств', 'getting to know'],
    vocab: ['звать', 'откуда', 'жить', 'город', 'страна', 'работать', 'учиться', 'свободное время'],
    turns: [
      {
        question: 'Как тебя зовут?',
        questionTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        scaffold: 'Меня зовут Анна. А тебя? Как тебя зовут?',
        scaffoldTr: { ru: 'Меня зовут Анна. А тебя? Как тебя зовут?', en: 'My name is Anna. And you? What is your name?' },
        reask: 'Как тебя зовут, ещё раз?',
        reaskTr: { ru: 'Как тебя зовут, ещё раз?', en: 'What was your name again?' },
        reactions: { positive: 'Привет и добро пожаловать!', negative: 'Привет!', short: 'Привет!' },
        chips: ['Меня зовут Саша.', 'Моё имя Мария.', 'Я Алекс.'],
        tutorFacts: ['Меня зовут Анна, я твой преподаватель русского.'],
      },
      {
        question: 'Откуда ты?',
        questionTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        scaffold: 'Я из России. А ты? Из какой ты страны?',
        scaffoldTr: { ru: 'Я из России. А ты? Из какой ты страны?', en: 'I am from Russia. And you? What country are you from?' },
        reask: 'Откуда ты, ещё раз?',
        reaskTr: { ru: 'Откуда ты, ещё раз?', en: 'Where are you from, again?' },
        reactions: { positive: 'Приятно познакомиться!', negative: 'Приятно познакомиться!', short: 'Всё хорошо!' },
        chips: ['Я из Германии.', 'Я из Испании.', 'Я из России.'],
        tutorFacts: ['Я из России, из Москвы.'],
      },
      {
        question: 'Где ты сейчас живёшь?',
        questionTr: { ru: 'Где ты сейчас живёшь?', en: 'Where do you live now?' },
        scaffold: 'Я живу в Москве. А ты? В каком городе ты живёшь?',
        scaffoldTr: { ru: 'Я живу в Москве. А ты? В каком городе ты живёшь?', en: 'I live in Moscow. And you? What city do you live in?' },
        reask: 'Где ты живёшь?',
        reaskTr: { ru: 'Где ты живёшь?', en: 'Where do you live?' },
        reactions: { positive: 'Интересно!', negative: 'Всё хорошо!', short: 'Не проблема!' },
        chips: ['Я живу в Берлине.', 'Я живу в маленькой деревне.', 'Я живу с семьёй.'],
        tutorFacts: ['Я живу в Москве.'],
      },
      {
        question: 'Чем ты занимаешься? Работа или учёба?',
        questionTr: { ru: 'Чем ты занимаешься? Работа или учёба?', en: 'What do you do? Work or study?' },
        scaffold: 'Я преподаватель. А ты? Кем ты работаешь?',
        scaffoldTr: { ru: 'Я преподаватель. А ты? Кем ты работаешь?', en: 'I am a teacher. And you? What is your job?' },
        reask: 'А кем ты работаешь?',
        reaskTr: { ru: 'А кем ты работаешь?', en: 'And what is your job?' },
        reactions: { positive: 'Здорово!', negative: 'Хорошо!', short: 'Всё хорошо!' },
        chips: ['Я студент.', 'Я работаю инженером.', 'Я учительница.'],
        tutorFacts: ['Я преподаватель русского языка.'],
      },
      {
        question: 'А что ты любишь делать в свободное время?',
        questionTr: { ru: 'А что ты любишь делать в свободное время?', en: 'And what do you like doing in your free time?' },
        scaffold: 'Я люблю читать книги. А ты? Что ты любишь делать?',
        scaffoldTr: { ru: 'Я люблю читать книги. А ты? Что ты любишь делать?', en: 'I like reading books. And you? What do you like to do?' },
        reask: 'Так какое у тебя хобби?',
        reaskTr: { ru: 'Так какое у тебя хобби?', en: 'So what is your hobby?' },
        reactions: { positive: 'Это здорово!', negative: 'Не проблема!', short: 'Хорошо!' },
        chips: ['Я люблю играть в футбол.', 'Я люблю читать.', 'Я люблю готовить.'],
        tutorFacts: ['Я люблю слушать музыку и читать книги.'],
      },
    ],
  },
  {
    id: 'ru-a2-vyhodnye',
    lang: 'ru',
    level: 'A2',
    title: 'Выходные',
    titleTr: { ru: 'Выходные', en: 'At the weekend' },
    keywords: ['выходн', 'weekend', 'прошл', 'план', 'отпуск'],
    vocab: ['выходные', 'делать', 'смотреть', 'ходить', 'есть', 'навещать', 'сначала', 'потом', 'прошлые выходные'],
    turns: [
      {
        question: 'Что ты делал на выходных?',
        questionTr: { ru: 'Что ты делал на выходных?', en: 'What did you do at the weekend?' },
        scaffold: 'Я был в кино. А ты? Что ты делал?',
        scaffoldTr: { ru: 'Я был в кино. А ты? Что ты делал?', en: 'I was at the cinema. And you? What did you do?' },
        reask: 'Что ты делал на выходных?',
        reaskTr: { ru: 'Что ты делал на выходных?', en: 'What did you do at the weekend?' },
        reactions: { positive: 'Хорошо, что ты здесь!', negative: 'Привет!', short: 'Привет!' },
        chips: ['Я смотрел фильм.', 'Я гулял с друзьями.', 'Я был дома.'],
        tutorFacts: ['На выходных я был в парке и читал книгу.'],
      },
      {
        question: 'И как прошло? Расскажи!',
        questionTr: { ru: 'И как прошло? Расскажи!', en: 'And how was it? Tell me!' },
        scaffold: 'У меня было хорошо. А у тебя? Хорошо или скучно?',
        scaffoldTr: { ru: 'У меня было хорошо. А у тебя? Хорошо или скучно?', en: 'It was nice for me. And for you? Good or boring?' },
        reask: 'Как прошли твои выходные?',
        reaskTr: { ru: 'Как прошли твои выходные?', en: 'How was your weekend?' },
        reactions: { positive: 'Звучит как хорошие выходные!', negative: 'Иногда спокойные выходные тоже хорошо.', short: 'Всё хорошо!' },
        chips: ['Было очень хорошо.', 'Было скучно.', 'Было весело.'],
        tutorFacts: ['Мои выходные были спокойными и хорошими.'],
      },
      {
        question: 'Что ты делал потом?',
        questionTr: { ru: 'Что ты делал потом?', en: 'What did you do afterwards?' },
        scaffold: 'Потом я пил кофе. А ты?',
        scaffoldTr: { ru: 'Потом я пил кофе. А ты?', en: 'Afterwards I had a coffee. And you?' },
        reask: 'Что ты делал после этого?',
        reaskTr: { ru: 'Что ты делал после этого?', en: 'What did you do after that?' },
        reactions: { positive: 'Интересно, продолжай!', negative: 'Понимаю!', short: 'Хорошо!' },
        chips: ['Потом я ел пиццу.', 'Потом я пошёл домой.', 'Потом я долго спал.'],
        tutorFacts: ['Потом я выпил ещё кофе.'],
      },
      {
        question: 'А что ты будешь делать в следующие выходные?',
        questionTr: { ru: 'А что ты будешь делать в следующие выходные?', en: 'What are you doing next weekend?' },
        scaffold: 'Я навещу родителей. А ты? Останешься дома?',
        scaffoldTr: { ru: 'Я навещу родителей. А ты? Останешься дома?', en: 'I am visiting my parents. And you? Are you staying at home?' },
        reask: 'Какие у тебя планы на следующие выходные?',
        reaskTr: { ru: 'Какие у тебя планы на следующие выходные?', en: 'What are your plans for next weekend?' },
        reactions: { positive: 'Спасибо, что рассказал!', negative: 'Спасибо, что рассказал!', short: 'Хорошо!' },
        chips: ['Я навещу родителей.', 'Я останусь дома.', 'Я поеду на море.'],
        tutorFacts: ['В следующие выходные я навещу сестру.'],
      },
    ],
  },

  // ---------- Generic small talk: en / fr / es / pt ----------
  {
    id: 'en-a1-smalltalk',
    lang: 'en',
    level: 'A1',
    title: 'Small talk',
    titleTr: { ru: 'Свободная беседа', en: 'Small talk' },
    keywords: ['small talk', 'hello', 'name', 'hi', 'знаком', 'привет'],
    vocab: ['name', 'come from', 'live', 'job', 'hobby', 'like'],
    turns: [
      {
        question: 'What is your name?',
      questionTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        scaffold: 'My name is Anna. And you? What is your name?',
      scaffoldTr: { ru: 'Меня зовут Анна. А тебя? Как тебя зовут?', en: 'My name is Anna. And you? What is your name?' },
        reask: 'What was your name again?',
        reaskTr: { ru: 'Как ещё раз тебя зовут?', en: 'What was your name again?' },
        reactions: { positive: 'Hello and welcome!', negative: 'Hello!', short: 'Hello!' },
        chips: ['My name is Alex.', "I'm Maria.", 'You can call me Sam.'],
        tutorFacts: ['My name is Anna and I am your English tutor.'],
      },
      {
        question: 'Where are you from?',
      questionTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        scaffold: 'I am from London. And you? Where are you from?',
      scaffoldTr: { ru: 'Я из Лондона. А ты? Откуда ты?', en: 'I am from London. And you? Where are you from?' },
        reask: 'Where are you from?',
        reaskTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        reactions: { positive: 'Nice to meet you!', negative: 'Nice to meet you!', short: "That's fine!" },
        chips: ["I'm from Russia.", "I'm from Spain.", "I'm from Germany."],
        tutorFacts: ['I am from London.'],
      },
      {
        question: 'What do you like doing in your free time?',
      questionTr: { ru: 'Что ты любишь делать в свободное время?', en: 'What do you like doing in your free time?' },
        scaffold: 'I like reading books. And you? What do you like?',
      scaffoldTr: { ru: 'Я люблю читать книги. А ты? Что ты любишь?', en: 'I like reading books. And you? What do you like?' },
        reask: 'What is your hobby?',
        reaskTr: { ru: 'Какое у тебя хобби?', en: 'What is your hobby?' },
        reactions: { positive: 'That sounds great!', negative: "That's fine!", short: 'Okay!' },
        chips: ['I like playing football.', 'I like reading.', 'I like cooking.'],
        tutorFacts: ['I like music and long walks.'],
      },
      {
        question: 'What do you usually have for breakfast?',
      questionTr: { ru: 'Что ты обычно ешь на завтрак?', en: 'What do you usually have for breakfast?' },
        scaffold: 'I have tea and toast. And you?',
      scaffoldTr: { ru: 'Я пью чай с тостами. А ты?', en: 'I have tea and toast. And you?' },
        reask: 'What do you have for breakfast?',
        reaskTr: { ru: 'Что ты ешь на завтрак?', en: 'What do you have for breakfast?' },
        reactions: { positive: 'That sounds tasty!', negative: 'Interesting!', short: 'Okay!' },
        chips: ['I have coffee and bread.', 'I have eggs.', 'I do not eat breakfast.'],
        tutorFacts: ['I always have tea and toast.'],
      },
    ],
  },
  {
    id: 'fr-a1-smalltalk',
    lang: 'fr',
    level: 'A1',
    title: 'Faire connaissance',
    titleTr: { ru: 'Знакомство', en: 'Getting to know each other' },
    keywords: ['bonjour', 'salut', 'small talk', 'знаком', 'привет'],
    vocab: ['s’appeler', 'venir', 'habiter', 'le loisir', 'aimer', 'le petit déjeuner'],
    turns: [
      {
        question: 'Comment tu t’appelles ?',
      questionTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        scaffold: 'Je m’appelle Anna. Et toi ? Comment tu t’appelles ?',
      scaffoldTr: { ru: 'Меня зовут Анна. А тебя? Как тебя зовут?', en: 'My name is Anna. And you? What is your name?' },
        reask: 'Comment tu t’appelles ?',
        reaskTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        reactions: { positive: 'Bonjour et bienvenue !', negative: 'Bonjour !', short: 'Bonjour !' },
        chips: ['Je m’appelle Sacha.', 'Je m’appelle Marie.', 'Mon prénom est Alex.'],
        tutorFacts: ['Je m’appelle Anna et je suis ta prof de français.'],
      },
      {
        question: 'D’où viens-tu ?',
      questionTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        scaffold: 'Je viens de Paris. Et toi ? Tu viens d’où ?',
      scaffoldTr: { ru: 'Я из Парижа. А ты? Откуда ты?', en: 'I am from Paris. And you? Where are you from?' },
        reask: 'Tu viens d’où ?',
        reaskTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        reactions: { positive: 'Enchantée !', negative: 'Enchantée !', short: 'C’est bien !' },
        chips: ['Je viens de Russie.', 'Je viens d’Espagne.', 'Je viens d’Allemagne.'],
        tutorFacts: ['Je viens de Paris.'],
      },
      {
        question: 'Qu’est-ce que tu aimes faire le week-end ?',
      questionTr: { ru: 'Что ты любишь делать на выходных?', en: 'What do you like doing at the weekend?' },
        scaffold: 'J’aime lire. Et toi ? Tu aimes quoi ?',
      scaffoldTr: { ru: 'Я люблю читать. А ты? Что ты любишь?', en: 'I like reading. And you? What do you like?' },
        reask: 'C’est quoi ton loisir ?',
        reaskTr: { ru: 'Какое у тебя хобби?', en: 'What is your hobby?' },
        reactions: { positive: 'C’est super !', negative: 'C’est bien !', short: 'D’accord !' },
        chips: ['J’aime jouer au foot.', 'J’aime lire.', 'J’aime cuisiner.'],
        tutorFacts: ['J’aime la musique et me promener.'],
      },
      {
        question: 'Qu’est-ce que tu manges au petit déjeuner ?',
      questionTr: { ru: 'Что ты ешь на завтрак?', en: 'What do you eat for breakfast?' },
        scaffold: 'Je mange du pain avec du beurre. Et toi ?',
      scaffoldTr: { ru: 'Я ем хлеб с маслом. А ты?', en: 'I eat bread with butter. And you?' },
        reask: 'Tu manges quoi le matin ?',
        reaskTr: { ru: 'Что ты ешь утром?', en: 'What do you eat in the morning?' },
        reactions: { positive: 'Ça a l’air bon !', negative: 'Intéressant !', short: 'D’accord !' },
        chips: ['Je bois un café.', 'Je mange du pain.', 'Je ne mange pas le matin.'],
        tutorFacts: ['Je bois toujours un café le matin.'],
      },
    ],
  },
  {
    id: 'es-a1-smalltalk',
    lang: 'es',
    level: 'A1',
    title: 'Charla',
    titleTr: { ru: 'Беседа', en: 'Chat' },
    keywords: ['hola', 'small talk', 'знаком', 'привет'],
    vocab: ['llamarse', 'ser de', 'vivir', 'el fin de semana', 'gustar', 'desayunar'],
    turns: [
      {
        question: '¿Cómo te llamas?',
      questionTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        scaffold: 'Yo me llamo Ana. ¿Y tú? ¿Cómo te llamas?',
      scaffoldTr: { ru: 'Меня зовут Ана. А ты? Как тебя зовут?', en: 'My name is Ana. And you? What is your name?' },
        reask: '¿Cómo te llamas?',
        reaskTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        reactions: { positive: '¡Hola y bienvenido!', negative: '¡Hola!', short: '¡Hola!' },
        chips: ['Me llamo Sacha.', 'Me llamo María.', 'Soy Alex.'],
        tutorFacts: ['Me llamo Ana y soy tu profesora de español.'],
      },
      {
        question: '¿De dónde eres?',
      questionTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        scaffold: 'Soy de Madrid. ¿Y tú? ¿De dónde eres?',
      scaffoldTr: { ru: 'Я из Мадрида. А ты? Откуда ты?', en: 'I am from Madrid. And you? Where are you from?' },
        reask: '¿De dónde eres?',
        reaskTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        reactions: { positive: '¡Mucho gusto!', negative: '¡Mucho gusto!', short: '¡Está bien!' },
        chips: ['Soy de Rusia.', 'Soy de España.', 'Soy de Alemania.'],
        tutorFacts: ['Soy de Madrid.'],
      },
      {
        question: '¿Qué te gusta hacer el fin de semana?',
      questionTr: { ru: 'Что ты любишь делать на выходных?', en: 'What do you like doing at the weekend?' },
        scaffold: 'Me gusta leer. ¿Y a ti? ¿Qué te gusta hacer?',
      scaffoldTr: { ru: 'Я люблю читать. А тебе? Что ты любишь делать?', en: 'I like reading. And you? What do you like to do?' },
        reask: '¿Cuál es tu hobby?',
        reaskTr: { ru: 'Какое у тебя хобби?', en: 'What is your hobby?' },
        reactions: { positive: '¡Qué bien!', negative: '¡Está bien!', short: '¡Vale!' },
        chips: ['Me gusta jugar al fútbol.', 'Me gusta leer.', 'Me gusta cocinar.'],
        tutorFacts: ['Me gusta la música y caminar.'],
      },
      {
        question: '¿Qué desayunas por la mañana?',
      questionTr: { ru: 'Что ты ешь на завтрак?', en: 'What do you have for breakfast?' },
        scaffold: 'Desayuno pan con aceite. ¿Y tú?',
      scaffoldTr: { ru: 'Я завтракаю хлебом с оливковым маслом. А ты?', en: 'I have bread with olive oil. And you?' },
        reask: '¿Qué desayunas?',
        reaskTr: { ru: 'Что ты ешь на завтрак?', en: 'What do you have for breakfast?' },
        reactions: { positive: '¡Qué rico!', negative: '¡Interesante!', short: '¡Vale!' },
        chips: ['Desayuno café con leche.', 'Como pan con mermelada.', 'No desayuno.'],
        tutorFacts: ['Siempre desayuno café con leche y tostadas.'],
      },
    ],
  },
  {
    id: 'pt-a1-smalltalk',
    lang: 'pt',
    level: 'A1',
    title: 'Conversa',
    titleTr: { ru: 'Разговор', en: 'Conversation' },
    keywords: ['olá', 'oi', 'small talk', 'знаком', 'привет'],
    vocab: ['se chamar', 'ser de', 'morar', 'fim de semana', 'gostar', 'café'],
    turns: [
      {
        question: 'Como você se chama?',
      questionTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        scaffold: 'Eu me chamo Ana. E você? Como você se chama?',
      scaffoldTr: { ru: 'Меня зовут Ана. А ты? Как тебя зовут?', en: 'My name is Ana. And you? What is your name?' },
        reask: 'Como você se chama?',
        reaskTr: { ru: 'Как тебя зовут?', en: 'What is your name?' },
        reactions: { positive: 'Olá e seja bem-vindo!', negative: 'Olá!', short: 'Olá!' },
        chips: ['Meu nome é Sacha.', 'Eu me chamo Maria.', 'Sou Alex.'],
        tutorFacts: ['Eu me chamo Ana e sou sua professora de português.'],
      },
      {
        question: 'De onde você é?',
      questionTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        scaffold: 'Eu sou de São Paulo. E você? De onde você é?',
      scaffoldTr: { ru: 'Я из Сан-Паулу. А ты? Откуда ты?', en: 'I am from São Paulo. And you? Where are you from?' },
        reask: 'De onde você é?',
        reaskTr: { ru: 'Откуда ты?', en: 'Where are you from?' },
        reactions: { positive: 'Prazer em conhecer você!', negative: 'Prazer em conhecer você!', short: 'Tudo bem!' },
        chips: ['Sou da Rússia.', 'Sou do Brasil.', 'Sou de Portugal.'],
        tutorFacts: ['Eu sou de São Paulo.'],
      },
      {
        question: 'O que você gosta de fazer no fim de semana?',
      questionTr: { ru: 'Что ты любишь делать на выходных?', en: 'What do you like doing at the weekend?' },
        scaffold: 'Eu gosto de ler. E você? O que você gosta de fazer?',
      scaffoldTr: { ru: 'Я люблю читать. А ты? Что ты любишь делать?', en: 'I like reading. And you? What do you like to do?' },
        reask: 'Qual é o seu hobby?',
        reaskTr: { ru: 'Какое у тебя хобби?', en: 'What is your hobby?' },
        reactions: { positive: 'Que legal!', negative: 'Tudo bem!', short: 'Ok!' },
        chips: ['Gosto de jogar futebol.', 'Gosto de ler.', 'Gosto de cozinhar.'],
        tutorFacts: ['Eu gosto de música e de caminhar.'],
      },
      {
        question: 'O que você toma no café da manhã?',
      questionTr: { ru: 'Что у тебя на завтрак?', en: 'What do you have for breakfast?' },
        scaffold: 'Eu tomo café com pão. E você?',
      scaffoldTr: { ru: 'Я пью кофе с хлебом. А ты?', en: 'I have coffee with bread. And you?' },
        reask: 'O que você toma no café da manhã?',
        reaskTr: { ru: 'Что у тебя на завтрак?', en: 'What do you have for breakfast?' },
        reactions: { positive: 'Que delícia!', negative: 'Interessante!', short: 'Ok!' },
        chips: ['Tomo café com leite.', 'Como pão com queijo.', 'Não tomo café da manhã.'],
        tutorFacts: ['Eu sempre tomo café com leite de manhã.'],
      },
    ],
  },
]

// ---------- Scenario selection ----------

function scenarioLevelFor(level: Level): 'A1' | 'A2' {
  return level === 'A1' ? 'A1' : 'A2'
}

/** Pick the scenario for a language: keyword match against the sidebar topic
 *  first, then the level default. */
export function selectScenario(lang: TargetLang, level: Level, topic: string, topicId?: string): Scenario {
  const wanted = scenarioLevelFor(level)
  const bank = SCENARIOS.filter(s => s.lang === lang)
  // an explicit scenario id always wins — the topic picker stores ids, and a
  // title like "Small talk" must never collide with another scenario's
  // keywords (Kennenlernen used to catch it and the topic snapped back)
  if (topicId) {
    const byId = bank.find(s => s.id === topicId)
    if (byId) return byId
  }
  const t = topic.trim().toLowerCase()
  if (t) {
    const hit = bank.find(s => s.keywords.some(k => t.includes(k)))
    if (hit) return hit
  }
  return (
    bank.find(s => s.level === wanted) ??
    bank.find(s => s.level === 'A1') ??
    bank[0]
  )
}

export function scenarioById(id: string): Scenario | null {
  return SCENARIOS.find(s => s.id === id) ?? null
}

/** The next scenario of the language (round-robin) when the current one ends */
export function nextScenario(current: Scenario): Scenario {
  const bank = SCENARIOS.filter(s => s.lang === current.lang)
  if (bank.length <= 1) return current
  const idx = bank.findIndex(s => s.id === current.id)
  return bank[(idx + 1) % bank.length]
}

export function transitionLine(lang: TargetLang, next: Scenario): string {
  return TUTOR_TRANSITION[lang].replace('{topic}', next.title)
}

/** The tutor persona across ALL topics of the language — the answer bank for
 *  "und du?" questions. Must stay in sync with the per-turn tutorFacts. */
export const TUTOR_PERSONA: Record<TargetLang, string[]> = {
  de: [
    'Ich heiße Anna und bin Deutschlehrerin.',
    'Ich komme aus Deutschland, aus Berlin.',
    'Ich wohne in Berlin.',
    'Ich trinke morgens immer Kaffee mit Milch und ein bisschen Zucker.',
    'Ich esse gern ein Brötchen mit Käse.',
    'Ich frühstücke jeden Tag.',
    'Ich koche gern und gehe gern im Park spazieren.',
    'Ich höre gern Musik und lese Bücher.',
    'Am Wochenende war ich im Park und habe ein Buch gelesen.',
    'Nächstes Wochenende besuche ich meine Schwester.',
  ],
  en: [
    'My name is Anna and I am an English tutor.',
    'I come from London.',
    'I always have tea and toast for breakfast.',
    'I like music and long walks.',
    'At the weekend I read books in the park.',
  ],
  fr: [
    'Je m’appelle Anna et je suis ta prof de français.',
    'Je viens de Paris.',
    'Je bois toujours un café le matin.',
    'J’aime la musique et me promener.',
  ],
  es: [
    'Me llamo Ana y soy tu profesora de español.',
    'Soy de Madrid.',
    'Siempre desayuno café con leche y tostadas.',
    'Me gusta la música y caminar.',
  ],
  pt: [
    'Eu me chamo Ana e sou sua professora de português.',
    'Eu sou de São Paulo.',
    'Eu sempre tomo café com leite de manhã.',
    'Eu gosto de música e de caminhar.',
  ],
  ru: [
    'Меня зовут Анна, я преподаватель русского языка.',
    'Я из России, из Москвы.',
    'Я живу в Москве.',
    'Утром я всегда пью кофе с молоком и немного сахара.',
    'Я люблю бутерброд с сыром.',
    'Я завтракаю каждый день.',
    'Я люблю готовить и гулять в парке.',
    'Я читаю книги и слушаю музыку.',
    'Я была в кино на выходных.',
    'Моё любимое время года — осень.',
  ],
}

/** Top-3 persona facts for the student's question: score = shared content
 *  stems (contentStems); the current turn's own facts get +0.5 so a bare
 *  "Und du?" still echoes the live question's answer. */
export function selectTutorFacts(
  lang: TargetLang,
  turn: ScenarioTurn | null,
  userText: string,
): string[] {
  const q = contentStems(userText)
  const pool: Array<{ fact: string; score: number }> = []
  for (const fact of TUTOR_PERSONA[lang]) {
    let score = 0
    for (const s of contentStems(fact)) if (q.has(s)) score++
    pool.push({ fact, score })
  }
  if (turn) {
    for (const f of turn.tutorFacts) {
      let score = 0.5
      for (const s of contentStems(f)) if (q.has(s)) score++
      pool.push({ fact: f, score })
    }
  }
  const seen = new Set<string>()
  return pool
    .sort((a, b) => b.score - a.score)
    .filter(p => (seen.has(p.fact) ? false : seen.add(p.fact)))
    .slice(0, 3)
    .map(p => p.fact)
}

/** Top-ranked persona fact with its relevance score (see selectTutorFacts). */
export function topTutorFact(
  lang: TargetLang,
  turn: ScenarioTurn | null,
  userText: string,
): { fact: string; score: number } | null {
  const q = contentStems(userText)
  let best: { fact: string; score: number } | null = null
  const consider = (fact: string, base: number) => {
    let score = base
    for (const s of contentStems(fact)) if (q.has(s)) score++
    if (!best || score > best.score) best = { fact, score }
  }
  if (turn) for (const f of turn.tutorFacts) consider(f, 0.5)
  for (const fact of TUTOR_PERSONA[lang]) consider(fact, 0)
  return best
}

// ---------- Session state (persisted per language alongside the dialog) ----------

export interface TutorSession {
  scenarioId: string
  /** index of the scenario turn whose question will be asked NEXT */
  nextIndex: number
  /** the extraPrompt value the scenario was selected for — re-select on change */
  topicKey: string
  /** consecutive relevance-gate stays (advance is forced after 2) */
  stayCount?: number
  /** the last question the tutor asked (re-asks pick a different variant) */
  lastQuestion?: string
}

export function newSession(scenario: Scenario, topicKey: string): TutorSession {
  return { scenarioId: scenario.id, nextIndex: 0, topicKey }
}
