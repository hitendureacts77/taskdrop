/**
 * A rough check for a request that is not words at all ("Jdjshrjensjjsks",
 * "Hdhs"), so the post writer does not dress keyboard mashing up as a task
 * (owner, 2026-10-30). It only looks at Latin letters: Hindi, Telugu and other
 * scripts, numbers and short words like "AC" or "TV" are always let through.
 * The person is asked to rephrase; nothing is posted until they do.
 */

const VOWELS = /[aeiouy]/;
// Five consonants in a row hardly happens in English or in Hinglish
// spellings ("strengths" is the rare exception, and it is one word of many).
const CONSONANT_RUN = /[bcdfghjklmnpqrstvwxz]{5,}/;
// The same letter four times ("aaaa", "kkkkk").
const REPEAT = /(.)\1{3,}/;

function nonsense(word: string): boolean {
  if (word.length < 4) return false;
  if (!VOWELS.test(word)) return true;
  return CONSONANT_RUN.test(word) || REPEAT.test(word);
}

/** True when most of the Latin words in the text are not words. */
export function looksLikeGibberish(text: string): boolean {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => /^[a-z]+$/.test(w));
  // Another script, or only numbers: not ours to judge.
  if (words.length === 0) return false;
  const long = words.filter((w) => w.length >= 4);
  if (long.length === 0) return words.join('').length >= 4 && !words.some((w) => VOWELS.test(w));
  const bad = long.filter(nonsense).length;
  return bad / long.length >= 0.5;
}
