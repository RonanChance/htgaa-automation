import {
    ECHO_1536_MAX_X,
    ECHO_1536_MAX_Y,
    ECHO_1536_MIN_X,
    ECHO_1536_MIN_Y,
    ECHO_1536_SUBPITCH_X,
    ECHO_1536_SUBPITCH_Y,
    snapEcho1536Point
} from '$lib/echo-grid.js';

const ECHO_384_X_SPACING = 5;
const ECHO_384_Y_SPACING = 5;
const ECHO_384_MAX_X = 23 * ECHO_384_X_SPACING;
const ECHO_384_MAX_Y = 15 * ECHO_384_Y_SPACING;

const ECHO_1536_X_SPACING = 2.5;
const ECHO_1536_Y_SPACING = 2.5;
const ECHO_1536_CLASSIC_MAX_X = 47 * ECHO_1536_X_SPACING;
const ECHO_1536_CLASSIC_MAX_Y = 31 * ECHO_1536_Y_SPACING;

export function shiftPoints(direction, new_spacing, old_spacing, radius_mm, point_colors, grid_style) {
    let dx = 0, dy = 0;

    // -------------------------
    // Direction → shift amount
    // -------------------------
    if (grid_style === "Echo384" || grid_style === "Echo384Image") {
        if (direction === "up") dy = -ECHO_384_Y_SPACING;
        else if (direction === "down") dy = ECHO_384_Y_SPACING;
        else if (direction === "left") dx = -ECHO_384_X_SPACING;
        else if (direction === "right") dx = ECHO_384_X_SPACING;
    } 
    else if (grid_style === "Echo1536" || grid_style === "Echo1536Image") {
        if (direction === "up") dy = -ECHO_1536_Y_SPACING;
        else if (direction === "down") dy = ECHO_1536_Y_SPACING;
        else if (direction === "left") dx = -ECHO_1536_X_SPACING;
        else if (direction === "right") dx = ECHO_1536_X_SPACING;
    }
    else if (grid_style === "Echo6144" || grid_style === "Echo6144Image") {
        if (direction === "up") dy = -ECHO_1536_SUBPITCH_Y;
        else if (direction === "down") dy = ECHO_1536_SUBPITCH_Y;
        else if (direction === "left") dx = -ECHO_1536_SUBPITCH_X;
        else if (direction === "right") dx = ECHO_1536_SUBPITCH_X;
    }
    else {
        if (direction === "up") dy = new_spacing;
        else if (direction === "down") dy = -new_spacing;
        else if (direction === "left") dx = -new_spacing;
        else if (direction === "right") dx = new_spacing;
    }

    let shifted = {};

    // --------------------------------------------------
    // MODE: full regrid (direction === "all")
    // --------------------------------------------------
    if (direction === "all") {
        for (const key in point_colors) {
            const [xStr, yStr] = key.split(",").map(s => s.trim());
            const x = Number(xStr);
            const y = Number(yStr);

            let newX, newY;

            if (grid_style.startsWith("Echo384")) {
                const i = Math.round(x / ECHO_384_X_SPACING);
                const j = Math.round(y / ECHO_384_Y_SPACING);
                newX = Math.max(0, Math.min(i * ECHO_384_X_SPACING, ECHO_384_MAX_X));
                newY = Math.max(0, Math.min(j * ECHO_384_Y_SPACING, ECHO_384_MAX_Y));
            }
            else if (grid_style === "Echo1536" || grid_style === "Echo1536Image") {
                const i = Math.round(x / ECHO_1536_X_SPACING);
                const j = Math.round(y / ECHO_1536_Y_SPACING);
                newX = Math.max(0, Math.min(i * ECHO_1536_X_SPACING, ECHO_1536_CLASSIC_MAX_X));
                newY = Math.max(0, Math.min(j * ECHO_1536_Y_SPACING, ECHO_1536_CLASSIC_MAX_Y));
            }
            else if (grid_style.startsWith("Echo6144")) {
                const snapped = snapEcho1536Point(x, y);
                newX = snapped.x;
                newY = snapped.y;

                if (newX < ECHO_1536_MIN_X || newX > ECHO_1536_MAX_X || newY < ECHO_1536_MIN_Y || newY > ECHO_1536_MAX_Y)
                    continue;
            }
            else {
                const i = Math.round(x / old_spacing);
                const j = Math.round(y / old_spacing);
                newX = i * new_spacing;
                newY = j * new_spacing;
            }

            shifted[`${newX.toFixed(3)}, ${newY.toFixed(3)}`] = point_colors[key];
        }

        return shifted;
    }

    // --------------------------------------------------
    // MODE: shift by vector (dx, dy)
    // --------------------------------------------------
    for (const key in point_colors) {
        const [xStr, yStr] = key.split(",").map(s => s.trim());
        const x = Number(xStr);
        const y = Number(yStr);

        let newX = x + dx;
        let newY = y + dy;

        if (grid_style.startsWith("Echo384")) {
            newX = Math.max(0, Math.min(newX, ECHO_384_MAX_X));
            newY = Math.max(0, Math.min(newY, ECHO_384_MAX_Y));
        }
        else if (grid_style === "Echo1536" || grid_style === "Echo1536Image") {
            newX = Math.max(0, Math.min(newX, ECHO_1536_CLASSIC_MAX_X));
            newY = Math.max(0, Math.min(newY, ECHO_1536_CLASSIC_MAX_Y));
        }
        else if (grid_style.startsWith("Echo6144")) {
            if (newX < ECHO_1536_MIN_X || newX > ECHO_1536_MAX_X || newY < ECHO_1536_MIN_Y || newY > ECHO_1536_MAX_Y)
                continue;
        }
        else {
            // radial limit
            if (Math.sqrt(newX * newX + newY * newY) > radius_mm)
                continue;
        }

        shifted[`${newX.toFixed(3)}, ${newY.toFixed(3)}`] = point_colors[key];
    }

    return shifted;
}


export function roundPoint(p) {
    return Math.round(parseFloat(p) * 1000) / 1000;
}
