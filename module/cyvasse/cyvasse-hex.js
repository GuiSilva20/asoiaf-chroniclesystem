/** Axial hex geometry (pointy-top). Pure functions, no state. */

export const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** Unique integer per hex for radius <= 15. */
export const hexKey = (q, r) => (q + 16) * 64 + (r + 16);

export function distance(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function inBoard(q, r, radius) {
    return Math.abs(q) <= radius && Math.abs(r) <= radius && Math.abs(q + r) <= radius;
}

export function neighbors(q, r, radius) {
    const out = [];
    for (const [dq, dr] of DIRECTIONS) {
        if (inBoard(q + dq, r + dr, radius)) out.push({q: q + dq, r: r + dr});
    }
    return out;
}

/** Every hex of a board of the given radius. */
export function allHexes(radius) {
    const out = [];
    for (let r = -radius; r <= radius; r++) {
        for (let q = -radius; q <= radius; q++) {
            if (inBoard(q, r, radius)) out.push({q, r});
        }
    }
    return out;
}

function roundCube(x, y, z) {
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return {q: rx, r: rz};
}

/** Hexes crossed going from `a` to `b`, excluding `a` and including `b`. */
export function line(a, b) {
    const n = distance(a, b);
    const out = [];
    // The epsilon keeps lines that run exactly along a hex edge deterministic.
    const ax = a.q + 1e-6;
    const az = a.r + 2e-6;
    const ay = -ax - az;
    const bx = b.q;
    const bz = b.r;
    const by = -bx - bz;
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        out.push(roundCube(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t));
    }
    return out;
}

/** Board notation for a hex: column letter, row number ("f6" is the centre of a radius 5 board). */
export function hexLabel(q, r, radius) {
    return `${String.fromCharCode(97 + q + radius)}${r + radius + 1}`;
}

/** Point reflection through the centre: how side B mirrors side A. */
export const mirror = (hex) => ({q: -hex.q, r: -hex.r});
