/**
 * Token adjacency helpers used by Tabela 9-5 line 6 ("dano a todos os
 * oponentes adjacentes") and Tabela 9-6 line 2 ("atacar aliado"). Nothing
 * like this existed in the codebase before this feature - weapon "reach" is
 * plain flavor text, never parsed into an actual range.
 */

/** Distance in grid units between two tokens' centers. */
export function getDistance(tokenA, tokenB) {
    return canvas.grid.measurePath([tokenA.center, tokenB.center]).distance;
}

export function isAdjacent(tokenA, tokenB, {tolerance = 0.01} = {}) {
    if (tokenA === tokenB) return false;
    return getDistance(tokenA, tokenB) <= canvas.grid.distance + tolerance;
}

/**
 * Candidate tokens on the current scene: every combatant's token while a
 * combat is active (so unlinked/duplicate tokens resolve correctly), or
 * every placed token otherwise.
 */
function candidateTokens(excludeTokenIds) {
    const tokens = game.combat?.combatants?.size
        ? game.combat.combatants.map((c) => c.token?.object).filter(Boolean)
        : canvas.tokens.placeables;
    return tokens.filter((token) => !excludeTokenIds.includes(token.id));
}

/**
 * `dispositionFilter` is one of "hostile" or "friendly", read relative to
 * `originToken`'s own disposition. Neutral tokens never match either filter.
 */
function matchesDisposition(candidateToken, originToken, dispositionFilter) {
    if (!dispositionFilter) return true;
    const origin = originToken.document.disposition;
    const candidate = candidateToken.document.disposition;
    if (origin === CONST.TOKEN_DISPOSITIONS.NEUTRAL || candidate === CONST.TOKEN_DISPOSITIONS.NEUTRAL) {
        return false;
    }
    return dispositionFilter === "friendly" ? candidate === origin : candidate !== origin;
}

export function getCombatantsNear(originToken, {dispositionFilter = null, excludeTokenIds = []} = {}) {
    const excluded = [originToken.id, ...excludeTokenIds];
    return candidateTokens(excluded)
        .filter((token) => token.actor)
        .filter((token) => matchesDisposition(token, originToken, dispositionFilter))
        .filter((token) => isAdjacent(originToken, token));
}

export function getAdjacentHostiles(originToken) {
    return getCombatantsNear(originToken, {dispositionFilter: "hostile"});
}

export function getAdjacentFriendlies(originToken) {
    return getCombatantsNear(originToken, {dispositionFilter: "friendly"});
}

/**
 * Every token sharing `originToken`'s disposition, scene/combat-wide (no
 * distance limit) - for effects like "todos os aliados ... ate o fim do
 * combate" that are not restricted to who's standing nearby.
 */
export function getAllies(originToken) {
    const excluded = [originToken.id];
    return candidateTokens(excluded)
        .filter((token) => token.actor)
        .filter((token) => matchesDisposition(token, originToken, "friendly"));
}
