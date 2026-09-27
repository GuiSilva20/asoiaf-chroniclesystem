/** Seeded RNG (mulberry32) so a match can be replayed from its record. */
export function createRng(seed) {
    let state = seed >>> 0;
    const next = () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        /** integer in [0, n) */
        int: (n) => Math.floor(next() * n),
        pick: (list) => list[Math.floor(next() * list.length)],
        /** index chosen from `weights` proportionally */
        weighted(weights) {
            const total = weights.reduce((sum, w) => sum + w, 0);
            let roll = next() * total;
            for (let i = 0; i < weights.length; i++) {
                roll -= weights[i];
                if (roll < 0) return i;
            }
            return weights.length - 1;
        }
    };
}
