/**
 * Moderated, general-audience trivia bank for the "Did you know?" card.
 *
 * This screen is visible to every player in the lobby, including minors, so
 * facts must stay family-friendly. Rules for adding new entries:
 *  - No sexual, crude-bodily, gory, or profane content.
 *  - No references to drugs, self-harm, or graphic violence.
 *  - Keep each fact to one or two plain sentences (under ~280 chars).
 *
 * Every entry (and any legacy cached value) is checked with
 * {@link isFactAppropriate} before display, so an unsuitable string can
 * never reach the screen even if it slips into the list or old storage.
 */
export const CURATED_FACTS: string[] = [
  'Honey never spoils. Archaeologists have tasted 3,000-year-old honey from Egyptian tombs.',
  'Octopuses have three hearts and blue blood.',
  'Bananas are berries, but strawberries are not.',
  'A day on Venus is longer than its year.',
  'Sharks existed before trees.',
  'The Eiffel Tower grows about 15 cm taller in summer.',
  'Sea otters hold hands while sleeping so they do not drift apart.',
  'A group of flamingos is called a flamboyance.',
  'Honeybees can recognize human faces.',
  'The Anglo-Zanzibar War of 1896 lasted about 38 minutes.',
  "Scotland's national animal is the unicorn.",
  'There are more possible chess games than atoms in the observable universe.',
  'Sound travels faster in water than in air.',
  'A bolt of lightning is five times hotter than the surface of the sun.',
  'The Great Wall of China is held together in places with sticky rice mortar.',
  'Cows have best friends and get stressed when separated.',
  'The first oranges were green, not orange.',
  'Pineapples take about two years to grow a single fruit.',
  'The dot over the letters i and j is called a tittle.',
  'Glass is made from sand heated until it melts.',
  'The Moon drifts about 3.8 cm farther from Earth every year.',
  'Saturn would float in water because its average density is so low.',
  'A single cloud can weigh as much as 100 elephants.',
  'The human brain runs on about 20 watts — enough to power a dim light bulb.',
  'Ounce for ounce, your bones are stronger than concrete.',
  'Butterflies taste with their feet.',
  'A jiffy is a real unit of time: one hundredth of a second.',
  'Lego bricks from 1958 still fit bricks made today.',
  'The Eiffel Tower was originally proposed for Barcelona, which turned it down.',
  'Dolphins call each other by name using signature whistles.',
  'Watermelons are berries, botanically speaking.',
  'The first computer programmer was Ada Lovelace, in the 1840s.',
  'Hot water can sometimes freeze faster than cold water.',
  'The pyramids were built while mammoths still walked the Earth.',
  'Cleopatra lived closer in time to the Moon landing than to the building of the pyramids.',
  'Oxford University is older than the Aztec Empire.',
  'Nintendo was founded in 1889 to make hand-painted playing cards.',
  'A desert can bloom: dormant seeds in dry soil sprout within days of rain.',
]

/**
 * Blocklist for the content filter. Patterns are matched case-insensitively
 * against the whole fact string. When in doubt, leave a fact out — the bank
 * above is the allowlist and this is the safety net underneath it.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  // sexual content
  /\bsex\b|\bsexual\b|\bporn\b|\bnude\b|\bnaked\b|\berotic\b|\borgasm\b|\bpenis\b|\bvagina\b|\bbreast\b|\bgenital\b|\bcondom\b|\bprostitut/i,
  // crude bodily content
  /\bpoop\b|\bpoo\b|\bfart\b|\bpiss\b|\burine\b|\bvomit\b|\bpuke\b|\bsnot\b|\bmucus\b|\bbooger\b|\bdiarrh/i,
  /\bconstipat/i,
  /\bhemorrhoid\b|\bpiles\b/,
  // profanity / slurs-adjacent
  /\bfuck\b|\bshit\b|\bcunt\b|\bdick\b|\bcock\b|\bpussy\b|\bslut\b|\bwhore\b|\bbastard\b|\basshole\b|\bbitch\b/,
  // drugs, self-harm, graphic violence
  /\bcocaine\b|\bheroin\b|\bmeth\b|\bsuicide\b|\brape\b|\bmurder\b|\btorture\b/,
]

const MAX_FACT_LENGTH = 280

/** True when a fact string is safe to show to a general audience. */
export function isFactAppropriate(text: unknown): text is string {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed.length < 10 || trimmed.length > MAX_FACT_LENGTH) return false
  if (/https?:\/\//i.test(trimmed)) return false
  return !BLOCKED_PATTERNS.some((pattern) => pattern.test(trimmed))
}
