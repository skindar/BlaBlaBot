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
    keywords: ['kennenlern', 'знаком', 'знакомств', 'getName', 'name', 'имя', 'привет', 'hallo', 'guten tag', 'small talk', 'болтал'],
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
export function selectScenario(lang: TargetLang, level: Level, topic: string): Scenario {
  const wanted = scenarioLevelFor(level)
  const bank = SCENARIOS.filter(s => s.lang === lang)
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
