/**
 * THE FORM TALKS ABOUT A PERSON, AND IT HAS TO GET THEIR PRONOUNS RIGHT.
 *
 * Every label in the persona form was written as "her" — "Her doctor", "Fill
 * from her state", "She is not ready yet". Gus Whitaker is male, and the whole
 * form addressed him as a woman. Gender is an explicit field, so the labels can
 * simply follow it.
 *
 * WHERE GENDER IS NOT CHOSEN YET, THIS USES THEY/THEM — never "she". An author
 * opening a blank form has not told us anything, and guessing is how the
 * original defect happened. `they` reads naturally in every one of these
 * labels, so there is no cost to being correct.
 *
 * `Subject`/`Object`/`Possessive` are capitalised for sentence starts; the
 * lowercase forms are for mid-sentence. Verb agreement is the one thing a
 * pronoun table cannot do on its own — "she asks" versus "they ask" — so
 * `verb()` conjugates the present tense for the chosen pronoun.
 */

export type PersonaGender = string | null | undefined;

export interface Pronouns {
  /** she / he / they */
  subject: string;
  /** her / him / them */
  object: string;
  /** her / his / their */
  possessive: string;
  /** hers / his / theirs */
  possessivePronoun: string;
  /** Capitalised forms, for the start of a sentence. */
  Subject: string;
  Possessive: string;
  /** True when nothing has been chosen and we are using the neutral form. */
  neutral: boolean;
  /**
   * Present-tense agreement: verb('ask') is "asks" for she/he and "ask" for
   * they. Pass the bare stem. Handles the -es cases these labels actually use.
   */
  verb: (stem: string) => string;
  /** is / are — the one irregular these labels need. */
  is: string;
  /** was / were. */
  was: string;
  /** does / do. */
  does: string;
  /** has / have. */
  has: string;
}

const THIRD_PERSON_S = (stem: string): string => {
  if (/(?:s|sh|ch|x|z|o)$/i.test(stem)) return `${stem}es`;
  if (/[^aeiou]y$/i.test(stem)) return `${stem.slice(0, -1)}ies`;
  return `${stem}s`;
};

const SINGULAR = (subject: string, object: string, possessive: string, possessivePronoun: string): Pronouns => ({
  subject,
  object,
  possessive,
  possessivePronoun,
  Subject: subject.charAt(0).toUpperCase() + subject.slice(1),
  Possessive: possessive.charAt(0).toUpperCase() + possessive.slice(1),
  neutral: false,
  verb: THIRD_PERSON_S,
  is: 'is',
  was: 'was',
  does: 'does',
  has: 'has',
});

const NEUTRAL: Pronouns = {
  subject: 'they',
  object: 'them',
  possessive: 'their',
  possessivePronoun: 'theirs',
  Subject: 'They',
  Possessive: 'Their',
  neutral: true,
  // Singular they takes the plural verb form: "they ask", "they are".
  verb: (stem) => stem,
  is: 'are',
  was: 'were',
  does: 'do',
  has: 'have',
};

/**
 * Pronouns for a persona. Anything that is not recognisably male or female —
 * including the empty string a fresh form starts with — gets they/them.
 */
export function pronounsFor(gender: PersonaGender): Pronouns {
  const g = String(gender ?? '').trim().toLowerCase();
  if (g === 'male' || g === 'm' || g === 'man') return SINGULAR('he', 'him', 'his', 'his');
  if (g === 'female' || g === 'f' || g === 'woman') return SINGULAR('she', 'her', 'her', 'hers');
  return NEUTRAL;
}
