import QRCode from 'qrcode';

export function generateGrid(grid_style, radius_mm, grid_spacing_mm, QRCode_text, imageColors) {
    console.log('generate grid called');
    if (grid_style === 'Grid' || grid_style === 'Standard') return grid(radius_mm, grid_spacing_mm);
    else if (grid_style === 'Radial') return radial(radius_mm, grid_spacing_mm);
    else if (grid_style === 'Honeycomb') return honeycomb(radius_mm, grid_spacing_mm);
    else if (grid_style === 'QRCode') return qrcode(radius_mm, grid_spacing_mm, QRCode_text);
    else if (grid_style === 'Image') return image(radius_mm, grid_spacing_mm, imageColors);
    else if (grid_style === 'Echo384') return echo384();
    else if (grid_style === 'Echo384Image') return Echo384Image(imageColors);
    else if (grid_style === 'Echo1536') return Echo1536();
    else if (grid_style === 'Echo1536Image') return Echo1536Image(imageColors);
}

function grid(radius_mm, grid_spacing_mm) {
    const points = [];
    const radiusSquared = radius_mm * radius_mm;
    const steps = Math.floor(radius_mm / grid_spacing_mm);

    for (let yStep = -steps; yStep <= steps; yStep++) {
        const y = yStep * grid_spacing_mm;
        const ySquared = y * y;
        const xMax = Math.sqrt(Math.max(0, radiusSquared - ySquared));

        // Only iterate x within circle boundary
        const xStepMax = Math.floor(xMax / grid_spacing_mm);
        for (let xStep = -xStepMax; xStep <= xStepMax; xStep++) {
            const x = xStep * grid_spacing_mm;
            points.push({ x: x.toFixed(3), y: y.toFixed(3) });
        }
    }
    return points;
}

function radial(radius_mm, grid_spacing_mm) {
    let points = [];
    const numCircles = Math.floor(radius_mm / grid_spacing_mm); // Number of circles
    points.push({ x: 0, y: 0 });
    for (let i = 1; i <= numCircles; i++) {
        const radius = i * grid_spacing_mm; // Radius of the current circle
        const numPointsOnCircle = Math.floor(2 * Math.PI * radius / grid_spacing_mm); // Number of points around the circle

        for (let j = 0; j < numPointsOnCircle; j++) {
            const angle = (j / numPointsOnCircle) * (2 * Math.PI); // Angle for even distribution of points
            const x = radius * Math.cos(angle);
            const y = radius * Math.sin(angle);

            if (Math.sqrt(x * x + y * y) <= radius_mm) {
                points.push({ x: x.toFixed(3), y: y.toFixed(3) });
            }
        }
    }
    return points;
}

function honeycomb(radius_mm, grid_spacing_mm) {
    let points = [];
    // Honeycomb grid
    const offset = grid_spacing_mm * Math.sqrt(3) / 2; // Vertical offset for honeycomb pattern
    const rows = Math.ceil(radius_mm / offset); // Number of rows to generate (up to radius)

    // Generate the grid points, but don't add the center point here
    for (let row = 1; row <= rows; row++) {
        const yPos = row * offset;

        // Iterate over positive and negative x for each row
        const xRange = Math.floor(radius_mm / grid_spacing_mm);
        for (let i = -xRange; i <= xRange; i++) {
            let xPos = i * grid_spacing_mm;

            // For every other row, apply an offset (half grid_spacing_mm)
            if (row % 2 !== 0) {
                xPos += grid_spacing_mm / 2;
            }

            // Add points for the positive y-position row
            if (Math.sqrt(xPos * xPos + yPos * yPos) <= radius_mm) {
                points.push({ x: xPos.toFixed(3), y: yPos.toFixed(3) });
            }

            // Also check negative y-position row (symmetry)
            if (Math.sqrt(xPos * xPos + (-yPos) * (-yPos)) <= radius_mm) {
                points.push({ x: xPos.toFixed(3), y: -yPos.toFixed(3) });
            }
        }
    }

    // Now generate the center row (y = 0), without duplicating the center point
    const centerRowY = 0;
    const xRange = Math.floor(radius_mm / grid_spacing_mm);
    for (let i = -xRange; i <= xRange; i++) {
        const xPos = i * grid_spacing_mm;
        // Only add the center point if it's not already included
        if (Math.sqrt(xPos * xPos + centerRowY * centerRowY) <= radius_mm) {
            points.push({ x: xPos.toFixed(3), y: centerRowY.toFixed(3) });
        }
    }
    return points;
}

function qrcode(radius_mm, grid_spacing_mm, QRCode_text) {
    let points = [];
    if (!QRCode_text) return points;

    const qr = QRCode.create(QRCode_text, { errorCorrectionLevel: 'H' });

    const modules = qr.modules;
    const size = modules.size;

    const matrix = [];
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) {
            row.push(modules.get(x, y));
        }
        matrix.push(row);
    }

    const half = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!matrix[y][x]) continue;

            const xPos = (x - half) * grid_spacing_mm;
            const yPos = (half - y) * grid_spacing_mm;

            if (Math.sqrt(xPos * xPos + yPos * yPos) <= radius_mm) {
                points.push({ x: xPos.toFixed(3), y: yPos.toFixed(3) });
            }
        }
    }
    return points;
}

function image(radius_mm, grid_spacing_mm, imageColors) {
    const points = [];
    const size = imageColors.length;
    if (size === 0) return points;

    const half = (size - 1) / 2;
    const radiusSquared = radius_mm * radius_mm;

    for (let y = 0; y < size; y++) {
        const yPos = (half - y) * grid_spacing_mm;
        const yPosSquared = yPos * yPos;

        for (let x = 0; x < size; x++) {
            const color = imageColors[y][x];
            if (!color) continue;

            const xPos = (x - half) * grid_spacing_mm;
            const distSquared = xPos * xPos + yPosSquared;

            if (distSquared <= radiusSquared) {
                points.push({ x: xPos.toFixed(3), y: yPos.toFixed(3), color });
            }
        }
    }
    return points;
}

function echo525(grid_spacing_mm) {
    const width_mm = 128;
    const height_mm = 86;
    const points = [];

    const x_half = width_mm / 2;
    const y_half = height_mm / 2;

    // Calculate number of steps from center to edges
    const x_steps = Math.floor(x_half / grid_spacing_mm);
    const y_steps = Math.floor(y_half / grid_spacing_mm);

    // Layered iteration from center
    for (let layer = 0; layer <= Math.max(x_steps, y_steps); layer++) {
        for (let dy = -layer; dy <= layer; dy++) {
            if (Math.abs(dy) > y_steps) continue;
            for (let dx = -layer; dx <= layer; dx++) {
                if (Math.abs(dx) > x_steps) continue;

                // Only add points on the current layer perimeter
                if (Math.abs(dx) === layer || Math.abs(dy) === layer) {
                    const x = dx * grid_spacing_mm;
                    const y = dy * grid_spacing_mm;
                    points.push({ x: x.toFixed(3), y: y.toFixed(3) });
                }
            }
        }
    }

    return points;
}

function echo384() {
    const width_mm = 128;
    const height_mm = 86;
    const rows = 16;
    const cols = 24;
    const points = [];

    // Calculate spacing between wells
    const x_spacing = 5;
    const y_spacing = 5;

    // Fill points row by row
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = col * x_spacing;
            const y = row * y_spacing;
            points.push({ x: x.toFixed(3), y: y.toFixed(3) });
        }
    }

    return points;
}

function Echo384Image(imageColors) {
    const points = [];
    const rows = 16;
    const cols = 24;
    if (!imageColors || !imageColors.length || !imageColors[0].length) return points;

    const x_spacing = 5;  // mm between columns
    const y_spacing = 5;  // mm between rows

    const imgH = imageColors.length;
    const imgW = imageColors[0].length;

    const { padX, padY, drawCols, drawRows } = containRect(cols, rows, imgW, imgH);

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const color = sampleContainedImage(imageColors, col, row, {
                padX,
                padY,
                drawCols,
                drawRows
            });

            const xPos = col * x_spacing;  // same as echo384
            const yPos = row * y_spacing;  // same as echo384

            points.push({
                x: xPos.toFixed(3),
                y: yPos.toFixed(3),
                color
            });
        }
    }

    return points;
}

function Echo1536() {
    const width_mm = 128;
    const height_mm = 86;
    const rows = 32;
    const cols = 48;
    const points = [];

    // 1536-well pitch
    const x_spacing = 2.5;
    const y_spacing = 2.5;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = col * x_spacing;
            const y = row * y_spacing;
            points.push({ x: x.toFixed(3), y: y.toFixed(3) });
        }
    }

    return points;
}

const E1536_GRID = [];
const ROWS = 32;
const COLS = 48;
const X_SPACING = 2.5;
const Y_SPACING = 2.5;

// Precompute positions
for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
        E1536_GRID.push({
            x: +(col * X_SPACING).toFixed(3),
            y: +(row * Y_SPACING).toFixed(3),
            row,
            col
        });
    }
}

function Echo1536Image(imageColors) {
    const points = [];
    const rows = 32;
    const cols = 48;
    if (!imageColors || !imageColors.length || !imageColors[0].length) return points;

    const x_spacing = 2.5;  // mm between columns for 1536
    const y_spacing = 2.5;  // mm between rows for 1536

    const imgH = imageColors.length;
    const imgW = imageColors[0].length;

    const { padX, padY, drawCols, drawRows } = containRect(cols, rows, imgW, imgH);

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const color = sampleContainedImage(imageColors, col, row, {
                padX,
                padY,
                drawCols,
                drawRows
            });

            const xPos = col * x_spacing;
            const yPos = row * y_spacing;

            points.push({
                x: xPos.toFixed(3),
                y: yPos.toFixed(3),
                color
            });
        }
    }

    return points;
}

function containRect(targetCols, targetRows, sourceW, sourceH) {
    const targetAspect = targetCols / targetRows;
    const sourceAspect = sourceW / sourceH;

    let drawCols;
    let drawRows;

    if (sourceAspect > targetAspect) {
        drawCols = targetCols;
        drawRows = targetCols / sourceAspect;
    } else {
        drawRows = targetRows;
        drawCols = targetRows * sourceAspect;
    }

    return {
        padX: (targetCols - drawCols) / 2,
        padY: (targetRows - drawRows) / 2,
        drawCols,
        drawRows
    };
}

function sampleContainedImage(imageColors, col, row, rect) {
    const { padX, padY, drawCols, drawRows } = rect;
    const imgH = imageColors.length;
    const imgW = imageColors[0].length;

    if (
        col < padX ||
        col > padX + drawCols - 1 ||
        row < padY ||
        row > padY + drawRows - 1
    ) {
        return '#FFFFFF';
    }

    const u = drawCols > 1 ? (col - padX) / (drawCols - 1) : 0.5;
    const v = drawRows > 1 ? (row - padY) / (drawRows - 1) : 0.5;

    const imgX = Math.max(0, Math.min(imgW - 1, Math.round(u * (imgW - 1))));
    const imgY = Math.max(0, Math.min(imgH - 1, Math.round(v * (imgH - 1))));

    return imageColors[imgY]?.[imgX] ?? '#FFFFFF';
}
