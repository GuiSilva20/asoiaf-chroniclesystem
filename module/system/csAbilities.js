/**
 * The canonical ability list of the Chronicle System.
 *
 * Taken from "A Guerra dos Tronos RPG - Livro Básico", Capítulo 4: Habilidades
 * & Especialidades (p. 73-88). Two rules from that chapter shape this file:
 *
 *   "O narrador não é encorajado a expandir a lista de habilidades."
 *      -> abilities are a CLOSED list of 19. The sheet must not offer a
 *         free-form "new ability" button; it restores this list instead.
 *
 *   "Ao contrário de habilidades (que começam com 2 graduações),
 *    especialidades começam em 0."
 *      -> every character owns all 19 abilities at rank 2 from the start,
 *         and owns no specialties at all.
 *
 * Specialties ARE the part the table may extend ("sempre há espaço para mais
 * especialidades"), so the lists below are offered as suggestions on the
 * ability sheet rather than enforced.
 *
 * The `name` field below is the English fallback, NOT what gets written to an
 * item: csCharacterActor.getAbility() matches an ability by comparing item.name
 * against SystemUtils.localize() of the matching CS.constants.abilities.* entry,
 * so items are created and matched through localizedAbilityName() instead. The
 * two must agree or the derived stats (Health, Composure, Fatigue, Frustration,
 * max Injuries/Wounds) silently evaluate to zero.
 *
 * Consequence: switching the world language does NOT rename abilities already
 * stored on actors. Existing worlds need a one-off data migration.
 */

import SystemUtils from "../utils/systemUtils.js";

/**
 * The display name of a standard ability in the active language.
 *
 * getAbility() looks an ability up by comparing item.name against
 * SystemUtils.localize(CS.constants.abilities.*), so every place that CREATES
 * or MATCHES an ability item must go through here. Using the hard-coded
 * ability.name would make the two disagree the moment the language is not
 * English, and the derived stats would silently evaluate to zero.
 */
export function localizedAbilityName(ability) {
    return SystemUtils.localize(`CS.constants.abilities.${ability.key}`);
}

export const CS_DEFAULT_ABILITY_RATING = 2;
export const CS_DEFAULT_SPECIALTY_RATING = 0;
export const CS_MAX_MORTAL_RATING = 7;

export const CS_ABILITIES = [
    {key: "agility",        name: "Agility",         specialties: ["Acrobatics", "Balance", "Contortions", "Dodge", "Quickness"]},
    {key: "animalHandling", name: "Animal Handling", specialties: ["Charm", "Drive", "Ride", "Train"]},
    {key: "athletics",      name: "Athletics",       specialties: ["Climb", "Jump", "Run", "Strength", "Swim", "Throw"]},
    {key: "awareness",      name: "Awareness",       specialties: ["Empathy", "Notice"]},
    {key: "cunning",        name: "Cunning",         specialties: ["Decipher", "Logic", "Memory"]},
    {key: "deception",      name: "Deception",       specialties: ["Act", "Bluff", "Cheat", "Disguise"]},
    {key: "endurance",      name: "Endurance",       specialties: ["Resilience", "Stamina"]},
    {key: "fighting",       name: "Fighting",        specialties: ["Axes", "Bludgeons", "Brawling", "Fencing", "Long Blades", "Pole-Arms", "Shields", "Short Blades", "Spears"]},
    {key: "healing",        name: "Healing",         specialties: ["Diagnosis", "Treat Ailment", "Treat Injury"]},
    {key: "knowledge",      name: "Knowledge",       specialties: ["Education", "Research", "Streetwise"]},
    {key: "language",       name: "Language",        specialties: []},
    {key: "marksmanship",   name: "Marksmanship",    specialties: ["Bows", "Crossbows", "Siege Engines", "Thrown"]},
    {key: "persuasion",     name: "Persuasion",      specialties: ["Bargain", "Charm", "Convince", "Incite", "Intimidate", "Seduce", "Taunt"]},
    {key: "status",         name: "Status",          specialties: ["Breeding", "Reputation", "Stewardship", "Tourneys"]},
    {key: "stealth",        name: "Stealth",         specialties: ["Blend In", "Sneak"]},
    {key: "survival",       name: "Survival",        specialties: ["Forage", "Hunt", "Orientation", "Track"]},
    {key: "thievery",       name: "Thievery",        specialties: ["Pick Lock", "Sleight of Hand", "Steal"]},
    {key: "warfare",        name: "Warfare",         specialties: ["Command", "Strategy", "Tactics"]},
    {key: "will",           name: "Will",            specialties: ["Coordinate", "Courage", "Dedication"]}
];

/**
 * The item data for one standard ability, at the rank the rules start it on.
 */
export function buildAbilityItemData(ability) {
    return {
        name: localizedAbilityName(ability),
        type: "ability",
        img: "systems/chroniclesystem/assets/icons/ability.png",
        system: {
            rating: CS_DEFAULT_ABILITY_RATING,
            modifier: 0,
            specialties: [],
            description: ""
        }
    };
}

/**
 * The full starting set — what a freshly created character should own.
 */
export function buildDefaultAbilityItems() {
    return CS_ABILITIES.map(buildAbilityItemData);
}

/**
 * The standard abilities an actor is missing, as ready-to-create item data.
 * Compared case-insensitively so abilities the user typed by hand ("agility")
 * are recognised instead of being duplicated.
 *
 * An ability counts as owned under EITHER its localized name or its English
 * canonical name. A world whose actors predate a language switch still holds
 * "Agility" while localizedAbilityName() now returns "Agilidade"; matching only
 * the localized form would treat the ability as missing and create a second,
 * duplicate item alongside the original.
 */
export function buildMissingAbilityItems(actor) {
    const owned = new Set(
        actor.items
            .filter((item) => item.type === "ability")
            .map((item) => item.name.trim().toLowerCase())
    );

    return CS_ABILITIES
        .filter(
            (ability) =>
                !owned.has(localizedAbilityName(ability).toLowerCase()) &&
                !owned.has(ability.name.toLowerCase())
        )
        .map(buildAbilityItemData);
}

/**
 * The canonical key of a standard ability, from ANY of its known spellings.
 *
 * Item names, weapon `specialty` fields ("Fighting:Long Blades") and modifier
 * types ("agility") are all stored as text, in whatever language was active
 * when they were written. Comparing those strings directly breaks the moment
 * the world is translated, so every lookup resolves to this stable key first.
 *
 * Returns null for a non-standard ability the table invented, which callers
 * fall back to comparing by raw name.
 */
export function abilityKeyFromName(name) {
    if (!name) return null;
    const wanted = name.toString().trim().toLowerCase();
    const match = CS_ABILITIES.find(
        (ability) =>
            ability.name.toLowerCase() === wanted ||
            ability.key.toLowerCase() === wanted ||
            localizedAbilityName(ability).toLowerCase() === wanted
    );
    return match ? match.key : null;
}

/**
 * The canonical slug of a specialty, from any of its known spellings, scoped
 * to the ability that owns it. Returns null when it is not a book specialty.
 */
export function specialtySlugFromName(abilityKey, name) {
    if (!name || !abilityKey) return null;
    const ability = CS_ABILITIES.find((a) => a.key === abilityKey);
    if (!ability) return null;

    const wanted = name.toString().trim().toLowerCase();
    const match = ability.specialties.find(
        (spec) =>
            spec.toLowerCase() === wanted ||
            specialtyKey(spec).toLowerCase() === wanted ||
            localizedSpecialtyName(ability, spec).toLowerCase() === wanted
    );
    return match ? specialtyKey(match) : null;
}

/**
 * The options for a weapon's "test" picker, grouped by ability.
 *
 * The VALUE is canonical ("fighting:longBlades") and never translated, so a
 * weapon keeps working in any language; only the LABEL follows the active
 * one. Legacy weapons storing "Fighting:Long Blades" still resolve, because
 * abilityKeyFromName()/specialtySlugFromName() accept every known spelling.
 */
export function buildAbilitySpecialtyOptions() {
    const options = [];
    for (const ability of CS_ABILITIES) {
        const group = localizedAbilityName(ability);
        options.push({ value: `${ability.key}:`, label: group, group });
        for (const spec of ability.specialties) {
            options.push({
                value: `${ability.key}:${specialtyKey(spec)}`,
                label: `${group} (${localizedSpecialtyName(ability, spec)})`,
                group
            });
        }
    }
    return options;
}

/** The operators a damage formula may apply to the ability rating. */
export const CS_DAMAGE_OPERATORS = ["", "+", "-", "*", "/"];

/**
 * Reads a weapon damage formula: an ability, optionally followed by an
 * operator and a number ("@athletics+2", "@fighting", "@Animal Handling-1").
 *
 * The old parser built its regex from a plain string, so "\s" collapsed to a
 * literal "s" and the ability group was effectively [a-zA-Z]: names with a
 * space ("Animal Handling") were truncated at the space, and once translated,
 * names with an accent ("Astúcia") were truncated at the accent. Either way
 * getAbilityValue() then fell through to its silent default of 2.
 */
export function parseDamageFormula(formula) {
    const empty = { abilityKey: "", operator: "", modifier: "" };
    if (!formula) return empty;

    const match = formula.toString().trim().match(/^@\s*([^+\-*/]+?)\s*([+\-*/]?)\s*(\d*)\s*$/);
    if (!match) return empty;

    return {
        abilityKey: abilityKeyFromName(match[1]) ?? match[1].trim(),
        operator: match[2] ?? "",
        modifier: match[3] ?? ""
    };
}

/**
 * Writes the canonical form, "@athletics+2". The ability is stored as its key
 * so the formula never depends on the language the world happens to be in.
 */
export function formatDamageFormula({ abilityKey, operator, modifier }) {
    if (!abilityKey) return "";
    const hasModifier = operator && modifier !== "" && modifier !== null && modifier !== undefined;
    return `@${abilityKey}${hasModifier ? `${operator}${modifier}` : ""}`;
}

/**
 * The canonical "abilityKey:specialtySlug" for whatever a weapon has stored,
 * so the picker can preselect a legacy value written in another language.
 */
export function canonicalTestValue(stored) {
    if (!stored) return "";
    const [rawAbility, rawSpecialty] = stored.toString().split(":");
    const key = abilityKeyFromName(rawAbility);
    if (!key) return stored;
    const slug = specialtySlugFromName(key, rawSpecialty);
    return `${key}:${slug ?? ""}`;
}

/**
 * "Long Blades" -> "longBlades". The i18n key for one specialty.
 */
function specialtyKey(name) {
    return name
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((word, i) =>
            i === 0
                ? word.toLowerCase()
                : word[0].toUpperCase() + word.slice(1).toLowerCase()
        )
        .join("");
}

/**
 * The display name of a specialty in the active language.
 *
 * Scoped by the OWNING ability, because the same English term can translate
 * differently depending on where the book lists it: "Charm" is "Encantar"
 * under Animal Handling and "Charme" under Persuasion. Falls back to the
 * English name when a language has no entry for it.
 */
export function localizedSpecialtyName(ability, specialty) {
    const key = `CS.constants.specialtyNames.${ability.key}.${specialtyKey(specialty)}`;
    const localized = SystemUtils.localize(key);
    return localized === key ? specialty : localized;
}

/**
 * The specialties the book lists for an ability, by ability name. Used to
 * suggest names on the ability sheet; the table stays free to add its own.
 * Accepts the ability under its localized or its English name.
 */
export function getSuggestedSpecialties(abilityName) {
    if (!abilityName) return [];
    const wanted = abilityName.toString().trim().toLowerCase();
    const match = CS_ABILITIES.find(
        (ability) =>
            localizedAbilityName(ability).toLowerCase() === wanted ||
            ability.name.toLowerCase() === wanted
    );
    if (!match) return [];
    return match.specialties.map((s) => localizedSpecialtyName(match, s));
}
