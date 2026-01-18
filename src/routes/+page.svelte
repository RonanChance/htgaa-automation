<script>
    import { generateGrid } from './automation-art/generateGrid.js';
    import { shiftPoints, roundPoint } from './automation-art/pointTransformations.js';
    import { getPixelHexColors, hexToRgb, rgbToHex, closestNamedColor, getColorMapping } from './automation-art/imageProcessing.js';
    import { onMount, tick } from 'svelte';
    import { browser } from '$app/environment';
    import { page } from '$app/stores';
    import { current_well_colors_import, well_colors, old_well_colors, source_384_well_colors } from '$lib/proteins.js';
    import { fade } from 'svelte/transition';
    import { parseGIF, decompressFrames } from "gifuct-js";

    // LOCAL COPY
    let current_well_colors = $state({...current_well_colors_import})
    let ginkgo_mode = $state(true);

    // GRID DATA
    let grid_style = $state('Echo1536'); // 'Standard', 'Honeycomb', 'Radial', 'QRCode', 'Image'
    let radius_mm = $state(39.9);
    let grid_spacing_mm = $state(3);
    let prev_grid_spacing_mm = $state(3);
    let point_size = $state(0.75);
    let points = $state({});
    let point_colors = $state({}); // Typical workflow: edit point_colors then call groupByColors()
    let points_by_color = $state({});
    let hover_point = $state();

    // USER INTERFACE
    let show_outlines = $state(true);
    let current_point = $state({});
    let isDrawing;
    let loadingURLRecord = $state(false);
    let loadingAIRecord = $state(false);
    let uploading = $state(false);
    let current_color = $state('sfGFP');
    let contentToCopy = $state();
    let showBacteriaModal = $state(false);
    let animate = $state(false);
    let animateToken = 0;
    let isPainting = false;
    let lastKey = null;
    let groupScheduled = false;
    let downKey = null;
    let didMove = false;
    let downX = 0;
    let downY = 0;
    const DRAG_PX = 4;

    // DESIGN METADATA
    let title = $state('');
    let author = $state('');
    let twitter_handle = $state('');
    let QRCode_text = $state('');
    let estimatedPrintDuration = $state(0);
    
    // IMAGE DATA
    let pixelatedSrc = $state(null);
    let canvasSize = $state(1536);
    let pixelation = $state(4);
    let brightness = $state(90);
    let contrast = $state(150);
    let saturation = $state(130);
    let rotation = $state(0);
    let zoom = $state(1);
    let imageColors = $state([]);
    let file = null;
    let img = $state(null);
    let whiteBgReplacement = $state('Invisible');
    let sliderValue = Math.log(pixelation);
    let invertColors = $state(false);
    let color_mapping = getColorMapping(well_colors, false);

    // ECHO DATA
    let source_id = $state(1788555);
    let destination_id = $state(1788556);
    let starting_column = $state(1);
    let working_echo_volume_ul = $state(30);

    // DOWNLOAD DATA
    let scriptType = '96_deep_well'; // '96_deep_well' or '96_pcr'

    // GIF DATA
    let gifUrlInput = $state("");
    let gifUrlStatus = $state("idle"); 
    let lastLoadedGifUrl = null;
    let animationImages = $state([]);   // now: array<HTMLCanvasElement> extracted from GIF
    let animationFrames = $state([]);   // array<{ ...point_colors }>
    let isPrecomputing = $state(false);
    let isPlaying = $state(false);
    let isPaused = $state(false);
    let frameIndex = 0;
    let rafId = null;
    let frameMs = 1000 / 30;
    let currentFps = 12;
    let lastTs = 0;
    let gifUrlError = $state("");
    let isLoadingGif = $state(false);
    let skipNextGifRebuild = false;
    let gifHydrating = $state(false);
    let gifUrlDebounce = null;
    let rebuildProgress = $state(0);
    let rebuildTotal = $state(0);
    let scrubIndex = $state(0);
    let isScrubbing = $state(false);
    let pixelatedCanvas = $state(null);
    let previewCanvas = $state(null);
    let rebuildToken = 0;
    let lastGifSig = "";
    let mappingVersion = $state(0);
    const SAMPLE_W = 192;
    const SAMPLE_H = 192;
    let sampleCanvas;
    let sampleCtx;
    

    onMount(async () => {
        if (browser) {
            let loadRecordId = $page.url.searchParams.get('id');
            if (loadRecordId) {
                loadRecord(loadRecordId);
            }
            let isHTGAA = $page.url.searchParams.get('htgaa');
            if (isHTGAA) {
                console.log('HTGAA MODE')
                ginkgo_mode = false;
            }
            window.addEventListener('keydown', function(event) {
                if (Object.keys(point_colors).length > 0 && ['Standard', 'Grid', 'Image', 'Echo384', 'Echo384Image', 'Echo1536', 'Echo1536Image'].includes(grid_style)) {
                    const directions = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'};
                    const direction = directions[event.key];
                    if (direction) {
                        event.preventDefault();
                        point_colors = shiftPoints(direction, grid_spacing_mm, grid_spacing_mm, radius_mm, point_colors, grid_style);
                        groupByColors();
                    }
                }
                if (animate == true && event.key === ' ') {
                    const activeElement = document.activeElement;
                    const isTypable = activeElement.nodeName === 'INPUT' || activeElement.nodeName === 'TEXTAREA' || activeElement.isContentEditable;
                    if (!isTypable) {
                        event.preventDefault();
                        togglePlayback();
                    }
                }
                if (animate == true && event.key === 'Shift') {
                    const activeElement = document.activeElement;
                    const isTypable = activeElement.nodeName === 'INPUT' || activeElement.nodeName === 'TEXTAREA' || activeElement.isContentEditable;
                    if (!isTypable) { 
                        currentFps = 12;
                    }
                }
            });
            window.addEventListener('keyup', function(event) {
                if (animate == true && event.key === 'Shift') {
                    const activeElement = document.activeElement;
                    const isTypable = activeElement.nodeName === 'INPUT' || activeElement.nodeName === 'TEXTAREA' || activeElement.isContentEditable;
                    if (!isTypable) { 
                        currentFps *= 2;
                    }
                }
            });
            if (animate) {
                grid_style = 'Echo1536Image';
            }
        }
    });

    // Toggle blur on sliders
    function blurSlider() {
        if (Object.keys(point_colors).length > 0) {
            return !['Standard', 'Grid', 'QRCode', 'Image'].includes(grid_style)
        }
        if (grid_style === 'Echo384' || grid_style === 'Echo384Image' || grid_style === 'Echo1536' || grid_style === 'Echo1536Image') {
            return true
        }
        return false;
    }

    function resetValues() {
        // --- clear animation / GIF state ---
        stopPlayback?.();
        rebuildToken++;

        animationImages = [];
        animationFrames = [];
        frameIndex = 0;
        animate = false;

        gifUrlInput = "";
        gifUrlStatus = "idle";
        gifUrlError = "";

        isPrecomputing = false;
        isLoadingGif = false;
        rebuildProgress = 0;
        rebuildTotal = 0;

        // --- clear image pipeline ---
        img = null;
        file = null;
        pixelatedSrc = null;
        pixelatedCanvas = null;
        imageColors = [];

        // --- clear design state ---
        point_colors = {};
        points_by_color = {};
        QRCode_text = '';
        points = {};

        radius_mm = 40;
        animationImages = null;
    }


    async function loadRecord(id) {
        try {
            loadingURLRecord = true;
            const response = await fetch('/loadRecord', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 'id': id })
            });
            const r = await response.json();
            grid_spacing_mm = prev_grid_spacing_mm = r.record.grid_spacing_mm;
            radius_mm = r.record.radius_mm;
            point_size = r.record.point_size || 1;
            grid_style = r.record.grid_style;
            
            if (r.record.grid_style === 'Image' || r.record.grid_style === 'Echo384Image' || r.record.grid_style === 'Echo1536Image') {
                brightness = r.record.brightness;
                contrast = r.record.contrast;
                saturation = r.record.saturation;

                pixelation = r.record.pixelation;
                zoom = r.record.zoom || 1;
                rotation = r.record.rotation;
                canvasSize = r.record.canvas_size;

                if (r.record.gif_url) {
                    gifUrlInput = r.record.gif_url;
                    console.log(gifUrlInput);
                    await submitGifUrl();
                    loadingURLRecord = false;
                    return;
                }

                processImage(canvasSize, pixelation);
                console.log('pre-existing', point_colors);
            }

            point_colors = r.record.point_colors;
            // map old colors onto new colors
            for (const [k, v] of Object.entries(r.record.point_colors)) {
                point_colors[k] = { Green: 'sfGFP', Red: 'mRFP1', Orange: 'mKO2' }[v] || v;
            }
            groupByColors();

            console.log("point-colors", point_colors);
            showAlert("alert-success", "Loaded design successfully!");
        } catch (error) {
            showAlert("alert-warning", "Failed to load design.");
        }
        loadingURLRecord = false;
    }

    async function saveToGallery() {
        uploading = true;
        if (!point_colors || Object.keys(point_colors).length === 0) {
            showAlert("alert-warning", "Design cannot be empty.");
            uploading = false;
            return;
        }

        const response = await fetch('/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                author,
                points,
                grid_style,
                radius_mm,
                grid_spacing_mm,
                point_colors,
                point_size,
                canvasSize,
                pixelation,
                brightness,
                contrast,
                saturation,
                ginkgo_mode,
                lastLoadedGifUrl,
                zoom,
                rotation,
                pixelation
            })
        });
        let r = await response.json();
        
        if (r.success && !r.duplicate) {
            showAlert("alert-success", "Added to gallery!");
        } else if (r.duplicate) {
            showAlert("alert-warning", "Duplicate submission.");
        } else {
            showAlert("alert-error", "Error: try again later.");
        }
        uploading = false;
        // close the popup modal
        const modal = document.getElementById('upload_modal');
        modal.close();
    }
    
    function groupByColors() {
        const entries = Object.entries(point_colors);

        const uniqueColors = new Set(entries.map(([, color]) => color));

        points_by_color = {};
        for (const color of uniqueColors) {
            const key = `${color.toLowerCase()}_points`;
            points_by_color[key] = entries
                .filter(([, c]) => c === color)
                .map(([point]) => ({
                    point: point.split(',').map(roundPoint),
                    color
                }))
                .sort((a, b) => {
                    const [ax, ay] = a.point;
                    const [bx, by] = b.point;
                    return by - ay || ax - bx;
                });
        }
    }

    async function copyPointsToClipboard() {
        try {
            // Get the content to copy
            let content = contentToCopy.textContent;
            content = content.replace(/\s+/g, ' ');
            content = content.replace(/(\w+_points = \[[^\]]*\])/g, '$1\n');

            // Create a textarea for copying
            const textArea = document.createElement("textarea");
            textArea.value = content;

            // Temporarily add it to the DOM with minimal layout impact
            textArea.style.position = "absolute";
            textArea.style.opacity = "0";
            textArea.style.pointerEvents = "none";
            textArea.style.height = "1px";
            textArea.style.width = "1px";
            textArea.style.margin = "0";

            // Add the textarea to the body, select its content, and copy
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);

        } catch (err) {
            console.log("Failed to copy:", err);
        }
    }
    
    function formatPoints(points) {
        if (!points) return '[]';
        return `[${points.map(p => `(${p.point})`).join(", ")}]`;
    }

    async function downloadPythonFile() {
        // ALL INDIVIDUAL POINTS LISTS
        let python_individual_points_lists = Object.entries(points_by_color).map(([color, points]) => `${color} = ${formatPoints(points)}`).join('\n');
        
        // MAPPING OF POINTS TO COLOR NAMES
        let python_point_name_pairing = `point_name_pairing = [` + Object.entries(points_by_color).map(([color]) => { let nameWithoutSuffix = color.replace(/_points$/, ''); return `("${nameWithoutSuffix}", ${color})`;}).join(',') +`]`;

        // WELL COLORS
        const prefixes = ['A', 'B', 'C', 'D']; // row groups
        const maxNumber = 12; // wells per row

        // DYNAMIC WAY TO ASSIGN COLORS TO COLUMNS
        let well_colors_python_dictionary = Object.entries(current_well_colors_import).slice(2).map(([color], i) => {
            const prefixIndex = Math.floor(i / maxNumber) % prefixes.length;
            const number = (i % maxNumber) + 1;
            const well = `${prefixes[prefixIndex]}${number}`;
            const nameWithoutSuffix = color.replace(/_points$/, '');
            return `    '${well}': '${nameWithoutSuffix}'`;
        });

        const python_well_colors = `well_colors = {\n${well_colors_python_dictionary.join(',\n')}\n}`;

        // HARD CODED COLOR ASSIGNMENT FOR CONVENIENCE
        // let well_colors_python_dictionary = {
        //     'A1': 'sfGFP',
        //     'A2': 'mRFP1',
        //     'A3': 'mKO2',
        //     'A4': 'Venus',
        //     'A5': 'mRuby2',
        //     'A6': 'mCherry',
        //     'A7': 'mKate2_TF',
        //     'A8': 'mLychee_TF',
        //     'A9': 'mBanana',
        //     'A10': 'tdTomato',
        //     'A11': 'mScarlet_I',
        //     'A12': 'mPapaya',
        // }
        // 'A1': 'sfgfp',
        // 'A3': 'mrfp1',
        // 'A5': 'mko2',
        // 'A7': 'mkate2',
        // 'A9': 'sfgfp_mko2'

        // const python_well_colors = `well_colors = {\n${Object.entries(well_colors_python_dictionary)
        //     .map(([key, value]) => `    '${key}': '${value}'`)
        //     .join(',\n')}\n}`;

        // VOLUME TRACKING
        let volumeUsedEntries = Object.entries(points_by_color).map(([color]) => {
            const nameWithoutSuffix = color.replace(/_points$/, '');
            return `    '${nameWithoutSuffix}': 0`;
        });
        const volume_used = `volume_used = {\n${volumeUsedEntries.join(',\n')}\n}`;
        let scriptToCopy;

        // WITH DEEP-WELL PLATE SCRIPT
        if (scriptType === '96_deep_well') {
            scriptToCopy = `from opentrons import types

import string

metadata = {
    'protocolName': '{YOUR NAME} - Opentrons Art - HTGAA',
    'author': 'HTGAA',
    'source': 'HTGAA 2025',
    'apiLevel': '2.20'
}

Z_VALUE_AGAR = 2.0
POINT_SIZE = ${point_size}

${python_individual_points_lists}

${python_point_name_pairing}

# Robot deck setup constants
TIP_RACK_DECK_SLOT = 9
COLORS_DECK_SLOT = 6
AGAR_DECK_SLOT = 5
PIPETTE_STARTING_TIP_WELL = 'A1'

# Place the PCR tubes in this order
${python_well_colors}

${volume_used}

def update_volume_remaining(current_color, quantity_to_aspirate):
    rows = string.ascii_uppercase
    for well, color in list(well_colors.items()):
        if color == current_color:
            if (volume_used[current_color] + quantity_to_aspirate) > 250:
                # Move to next well horizontally by advancing row letter, keeping column number
                row = well[0]
                col = well[1:]
                
                # Find next row letter
                next_row = rows[rows.index(row) + 1]
                next_well = f"{next_row}{col}"
                
                del well_colors[well]
                well_colors[next_well] = current_color
                volume_used[current_color] = quantity_to_aspirate
            else:
                volume_used[current_color] += quantity_to_aspirate
            break

def run(protocol):
    # Load labware, modules and pipettes
    protocol.home()

    # Tips
    tips_20ul = protocol.load_labware('opentrons_96_tiprack_20ul', TIP_RACK_DECK_SLOT, 'Opentrons 20uL Tips')

    # Pipettes
    pipette_20ul = protocol.load_instrument("p20_single_gen2", "right", [tips_20ul])

    # Deep Well Plate
    temperature_plate = protocol.load_labware('nest_96_wellplate_2ml_deep', 6)

    # Agar Plate
    agar_plate = protocol.load_labware('htgaa_agar_plate', AGAR_DECK_SLOT, 'Agar Plate')
    agar_plate.set_offset(x=0.00, y=0.00, z=Z_VALUE_AGAR)

    # Get the top-center of the plate, make sure the plate was calibrated before running this
    center_location = agar_plate['A1'].top()

    pipette_20ul.starting_tip = tips_20ul.well(PIPETTE_STARTING_TIP_WELL)
    
    # Helper function (dispensing)
    def dispense_and_jog(pipette, volume, location):
        assert(isinstance(volume, (int, float)))
        # Go above the location
        above_location = location.move(types.Point(z=location.point.z + 2))
        pipette.move_to(above_location)
        # Go downwards and dispense
        pipette.dispense(volume, location)
        # Go upwards to avoid smearing
        pipette.move_to(above_location)

    # Helper function (color location)
    def location_of_color(color_string):
        for well,color in well_colors.items():
            if color.lower() == color_string.lower():
                return temperature_plate[well]
        raise ValueError(f"No well found with color {color_string}")

    # Print pattern by iterating over lists
    for i, (current_color, point_list) in enumerate(point_name_pairing):
        # Skip the rest of the loop if the list is empty
        if not point_list:
            continue

        # Get the tip for this run, set the bacteria color, and the aspirate bacteria of choice
        pipette_20ul.pick_up_tip()
        max_aspirate = int(18 // POINT_SIZE) * POINT_SIZE
        quantity_to_aspirate = min(len(point_list)*POINT_SIZE, max_aspirate)
        update_volume_remaining(current_color, quantity_to_aspirate)
        pipette_20ul.aspirate(quantity_to_aspirate, location_of_color(current_color))

        # Iterate over the current points list and dispense them, refilling along the way
        for i in range(len(point_list)):
            x, y = point_list[i]
            adjusted_location = center_location.move(types.Point(x, y))

            dispense_and_jog(pipette_20ul, POINT_SIZE, adjusted_location)
            
            if pipette_20ul.current_volume == 0 and len(point_list[i+1:]) > 0:
                quantity_to_aspirate = min(len(point_list[i:])*POINT_SIZE, max_aspirate)
                update_volume_remaining(current_color, quantity_to_aspirate)
                pipette_20ul.aspirate(quantity_to_aspirate, location_of_color(current_color))

        # Drop tip between each color
        pipette_20ul.drop_tip()
    `
    }
    // WITHOUT TEMPERATURE PLATE SCRIPT
    if (scriptType === '96_pcr') {
        scriptToCopy = `from opentrons import types

import string

metadata = {
    'protocolName': '{YOUR NAME} - Opentrons Art - HTGAA',
    'author': 'HTGAA',
    'source': 'HTGAA 2025',
    'apiLevel': '2.20'
}

Z_VALUE_AGAR = 2.0
POINT_SIZE = ${point_size}

${python_individual_points_lists}

${python_point_name_pairing}

# Robot deck setup constants
TIP_RACK_DECK_SLOT = 9
COLORS_DECK_SLOT = 6
AGAR_DECK_SLOT = 5
PIPETTE_STARTING_TIP_WELL = 'A1'

# Place the PCR tubes in this order
${python_well_colors}

${volume_used}

def update_volume_remaining(current_color, quantity_to_aspirate):
    rows = string.ascii_uppercase
    for well, color in list(well_colors.items()):
        if color == current_color:
            if (volume_used[current_color] + quantity_to_aspirate) > 250:
                # Move to next well horizontally by advancing row letter, keeping column number
                row = well[0]
                col = well[1:]
                
                # Find next row letter
                next_row = rows[rows.index(row) + 1]
                next_well = f"{next_row}{col}"
                
                del well_colors[well]
                well_colors[next_well] = current_color
                volume_used[current_color] = quantity_to_aspirate
            else:
                volume_used[current_color] += quantity_to_aspirate
            break

def run(protocol):
    # Load labware, modules and pipettes
    protocol.home()

    # Tips
    tips_20ul = protocol.load_labware('opentrons_96_tiprack_20ul', TIP_RACK_DECK_SLOT, 'Opentrons 20uL Tips')

    # Pipettes
    pipette_20ul = protocol.load_instrument("p20_single_gen2", "right", [tips_20ul])

    # PCR Plate
    temperature_plate = protocol.load_labware('opentrons_96_aluminumblock_generic_pcr_strip_200ul', 6)

    # Agar Plate
    agar_plate = protocol.load_labware('htgaa_agar_plate', AGAR_DECK_SLOT, 'Agar Plate')
    agar_plate.set_offset(x=0.00, y=0.00, z=Z_VALUE_AGAR)

    # Get the top-center of the plate, make sure the plate was calibrated before running this
    center_location = agar_plate['A1'].top()

    pipette_20ul.starting_tip = tips_20ul.well(PIPETTE_STARTING_TIP_WELL)
    
    # Helper function (dispensing)
    def dispense_and_jog(pipette, volume, location):
        assert(isinstance(volume, (int, float)))
        # Go above the location
        above_location = location.move(types.Point(z=location.point.z + 2))
        pipette.move_to(above_location)
        # Go downwards and dispense
        pipette.dispense(volume, location)
        # Go upwards to avoid smearing
        pipette.move_to(above_location)

    # Helper function (color location)
    def location_of_color(color_string):
        for well,color in well_colors.items():
            if color.lower() == color_string.lower():
                return temperature_plate[well]
        raise ValueError(f"No well found with color {color_string}")

    # Print pattern by iterating over lists
    for i, (current_color, point_list) in enumerate(point_name_pairing):
        # Skip the rest of the loop if the list is empty
        if not point_list:
            continue

        # Get the tip for this run, set the bacteria color, and the aspirate bacteria of choice
        pipette_20ul.pick_up_tip()
        max_aspirate = int(18 // POINT_SIZE) * POINT_SIZE
        quantity_to_aspirate = min(len(point_list)*POINT_SIZE, max_aspirate)
        update_volume_remaining(current_color, quantity_to_aspirate)
        pipette_20ul.aspirate(quantity_to_aspirate, location_of_color(current_color))

        # Iterate over the current points list and dispense them, refilling along the way
        for i in range(len(point_list)):
            x, y = point_list[i]
            adjusted_location = center_location.move(types.Point(x, y))

            dispense_and_jog(pipette_20ul, POINT_SIZE, adjusted_location)
            
            if pipette_20ul.current_volume == 0 and len(point_list[i+1:]) > 0:
                quantity_to_aspirate = min(len(point_list[i:])*POINT_SIZE, max_aspirate)
                update_volume_remaining(current_color, quantity_to_aspirate)
                pipette_20ul.aspirate(quantity_to_aspirate, location_of_color(current_color))

        # Drop tip between each color
        pipette_20ul.drop_tip()
    `
    }

        const now = new Date();
        const year = now.getFullYear().toString().slice(2);
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const seconds = String(now.getSeconds()).padStart(2, "0");

        const timestamp = `${month}-${day}-${year}_${hours}-${minutes}-${seconds}`;
        const filename = `OTDesign_${timestamp}.py`;

        const blob = new Blob([scriptToCopy], { type: "text/x-python" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename; // Use dynamically generated filename
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url); // Clean up the URL object
    }

    function downloadEchoCSV(ProtocolLauncher) {
        if (!Object.keys(points_by_color).length) return;
        
        let csvHeader = '';
        if (ProtocolLauncher) {
            csvHeader = 'RequestID,DestinationContainerSlot,DestinationContainerType,DestinationContainerID,DestinationWell,DestinationRow,DestinationColumn,ContentContainerSlot0,ContentContainerType0,ContentContainerID0,ContentWell0,ContentRow0,ContentColumn0,ContentVolume0\n';
        } else {
            csvHeader = 'Source Plate Name,Source Plate Barcode,Source Plate Type,Source Well,Destination Plate Name,Destination Plate Barcode,Destination Plate Type,Destination Well,Transfer Volume\n';
        }
        let csv = csvHeader;

        // Track current well and remaining volume per color
        const wellTracker = {}; // { color: { currentIndex, remainingVolume } }
        
        for (const [color, points] of Object.entries(points_by_color)) {
            const sourceWellPrefix = source_384_well_colors[stripAfterLastUnderscore(color)] || '';
            // Initialize tracker
            wellTracker[color] = { currentIndex: starting_column - 1, remainingVolume: working_echo_volume_ul };

            points.forEach(({ point }) => {
                let currentWellIndex = wellTracker[color].currentIndex;
                let remainingVolume = wellTracker[color].remainingVolume;

                // If remainingVolume is zero, move to next well
                if (remainingVolume <= 0) {
                    currentWellIndex += 1;
                    remainingVolume = working_echo_volume_ul;
                }

                // Compute source well
                const sourceWell = `${sourceWellPrefix}${currentWellIndex + 1}`; // A1 = index 0

                // Compute destination well
                const destRow = rowLabel1536(point[1] / 2.5);
                const destCol = point[0] / 2.5 + 1;
                const destWell = `${destRow}${destCol}`;

                if (ProtocolLauncher) {
                    csv += `11111,PipeSlot0,1-flat-thermo-264728-omni-1536,${destination_id},${destWell},0,0,SourceSlot0,384-well Plate Echo PP,${source_id},${sourceWell},0,0,0.1\n`;
                } else {
                    csv += `Echo_Artwork_Source,${source_id},384-well Plate Echo PP,${sourceWell},Echo_Artwork_Dest,${destination_id},1-flat-thermo-264728-omni-1536,${destWell},100\n`;
                }
                // Deduct used volume
                remainingVolume -= 0.1;

                // Update tracker
                wellTracker[color].currentIndex = currentWellIndex;
                wellTracker[color].remainingVolume = remainingVolume;
            });
        }

        const now = new Date();
        const year = now.getFullYear().toString().slice(2);
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const seconds = String(now.getSeconds()).padStart(2, "0");

        const timestamp = `${month}-${day}-${year}_${hours}-${minutes}-${seconds}`;
        const filename = `${ProtocolLauncher ? 'nebula_echo' : 'echo'}_artwork_${timestamp}.csv`;

        // Create downloadable link
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    let isToastVisible = $state(false);
    let alertMessage = $state('');
    let alertType = $state('');
	function showAlert(type = "alert-success", msg = "Success!") {
		isToastVisible = true;
        alertMessage = msg;
        alertType = type;
		setTimeout(() => { isToastVisible = false; }, 3000);
	}

        
    $effect(() => {
        points = generateGrid(grid_style, radius_mm, grid_spacing_mm, QRCode_text, imageColors);
        tick().then(() => {
            if (grid_style === 'QRCode') {
                    const new_colors = {};
                    for (const point of points) {
                        new_colors[`${point.x}, ${point.y}`] = 'sfGFP';
                    }
                    point_colors = new_colors;
                    groupByColors();
                }
            if (['Standard', 'Grid', 'Image', 'Echo384', 'Echo384Image', 'Echo1536', 'Echo1536Image'].includes(grid_style)) {
                const current = grid_spacing_mm;
                const previous = prev_grid_spacing_mm;
                if (current !== previous && !loadingURLRecord) {
                    point_colors = shiftPoints("all", current, previous, radius_mm, point_colors);
                    groupByColors();
                    prev_grid_spacing_mm = current;
                }
            }
            if (grid_style === 'Image' || grid_style === 'Echo384Image' || grid_style === 'Echo1536Image') {
            // allow point_colors to be computed during precompute/hydration
            if (animate && !isPrecomputing) return;

            if (img) {
                const new_colors = {};
                for (const point of points) {
                    const c = closestNamedColor(point.color, current_well_colors, well_colors, color_mapping);
                    if (c !== 'White' && c !== 'Erase') {
                    new_colors[`${point.x}, ${point.y}`] = c;
                    } else if ((c === 'White' || c === 'Erase') && whiteBgReplacement !== 'Invisible') {
                    new_colors[`${point.x}, ${point.y}`] = whiteBgReplacement;
                    }
                }
                point_colors = new_colors;
                groupByColors();
                }
            }
        });
    });


    async function gifFileToFrameCanvases(file) {
        const buf = await file.arrayBuffer();
        const gif = parseGIF(buf);
        const frames = decompressFrames(gif, true);

        const W = gif.lsd.width;
        const H = gif.lsd.height;

        const base = document.createElement("canvas");
        base.width = W;
        base.height = H;
        const bctx = base.getContext("2d", { willReadFrequently: true });

        bctx.fillStyle = "#fff";
        bctx.fillRect(0, 0, W, H);

        const prev = document.createElement("canvas");
        prev.width = W;
        prev.height = H;
        const prevCtx = prev.getContext("2d");

        const patch = document.createElement("canvas");
        patch.width = W;
        patch.height = H;
        const pctx = patch.getContext("2d");

        const out = [];

        for (const fr of frames) {
            const { left, top, width, height } = fr.dims;

            if (!width || !height) continue;

            if (fr.disposalType === 3) {
                prevCtx.clearRect(0, 0, W, H);
                prevCtx.drawImage(base, 0, 0);
            }

            pctx.clearRect(0, 0, W, H);

            const imageData = pctx.createImageData(width, height);
            imageData.data.set(fr.patch);
            pctx.putImageData(imageData, left, top);

            bctx.drawImage(patch, 0, 0);

            const snap = document.createElement("canvas");
            snap.width = W;
            snap.height = H;
            snap.getContext("2d").drawImage(base, 0, 0);

            out.push(snap);

            if (fr.disposalType === 2) {
                bctx.fillStyle = "#fff";
                bctx.fillRect(left, top, width, height);
            } else if (fr.disposalType === 3) {
                bctx.clearRect(0, 0, W, H);
                bctx.drawImage(prev, 0, 0);
            }
        }
        return out;
    }


    async function computeAllFrames() {
        if (!animationImages.length) return;

        isPrecomputing = true;
        animationFrames = [];
        grid_style = "Echo1536Image";
        
        brightness = 90;
        contrast = 120;
        saturation = 120;
        zoom = 1;
        pixelation = 4;
        rotation = 0;
        whiteBgReplacement = "Invisible";
        color_mapping = getColorMapping(well_colors, false);

        for (const frameCanvas of animationImages) {
            // Skip invalid frames (prevents drawImage width/height 0 errors)
            if (!frameCanvas || frameCanvas.width <= 0 || frameCanvas.height <= 0) continue;

            img = frameCanvas;
            processImage(canvasSize, pixelation);

            await tick();
            await tick();

            animationFrames.push({ ...point_colors });
            
            await new Promise((r) => setTimeout(r, 0));
        }

        isPrecomputing = false;
        scrubIndex = 0;
        frameIndex = 0;
    }

    function hasAnyKey(obj) {
        for (const _k in obj) return true;
        return false;
    }


    function startPlayback() {
        if (!animationFrames.length) return;

        frameMs = 1000 / currentFps;

        isPlaying = true;
        isPaused = false;
        lastTs = performance.now();

        const loop = (now) => {
            if (!isPlaying) return;

            if (!isPaused && now - lastTs >= frameMs) {
            lastTs = now;

            const len = animationFrames.length;
            const idx = frameIndex % len;
            frameIndex = idx + 1;

            let pc = animationFrames[idx];

            if (idx === 0 && pc && !hasAnyKey(pc) && len > 1) {
                const last = animationFrames[len - 1];
                if (last && hasAnyKey(last)) pc = last;
            }

            point_colors = pc;

            // keep scrubber synced unless user is actively dragging
            if (!isScrubbing) scrubIndex = idx;

            if (animationImages?.length) {
                pixelatedCanvas = animationImages[idx];  // no serialization, no huge strings
                }
            }

            rafId = requestAnimationFrame(loop);
        };

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(loop);
    }

    $effect(() => {
        if (!previewCanvas || !pixelatedCanvas) return;

        const w = pixelatedCanvas.width;
        const h = pixelatedCanvas.height;

        // only resize if it actually changed
        if (previewCanvas.width !== w) previewCanvas.width = w;
        if (previewCanvas.height !== h) previewCanvas.height = h;

        const ctx = previewCanvas.getContext("2d");
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(pixelatedCanvas, 0, 0);
    });


    $effect(() => {
        if (pixelation > canvasSize) pixelation = canvasSize;

        // Still image mode: keep live updating
        if (!animate && !isPrecomputing && !isLoadingGif && !gifHydrating) {
            processImage(canvasSize, pixelation, brightness, contrast, saturation, rotation, zoom);
            return;
        }

        // GIF mode: only run processImage while building frames
        if (animate && isPrecomputing) {
            processImage(canvasSize, pixelation, brightness, contrast, saturation, rotation, zoom);
        }
    });


    async function handleFileChange(event, optionalFilename = null) {
        file = event.target.files?.[0];    
        // media reset only
        stopPlayback?.();
        rebuildToken++;
        animationImages = [];
        animationFrames = [];
        frameIndex = 0;
        animate = false;
        img = null;
        pixelatedSrc = null;
        imageColors = [];
        isPrecomputing = false;
        isLoadingGif = false;
        rebuildProgress = 0;
        rebuildTotal = 0;

        gifUrlStatus = "idle";
        gifUrlError = "";

        // reset params (same as before)
        if (!loadingURLRecord) {
            brightness = 90;
            contrast = 120;
            saturation = 120;
            zoom = 0.91;
            pixelation = 4;
            rotation = 0;
        }

        whiteBgReplacement = 'Invisible';
        color_mapping = getColorMapping(well_colors, false);

        if (!file) return;

        // stop any existing playback when a new file is chosen
        stopPlayback?.();

        const isGif = file.type === "image/gif" || file.name?.toLowerCase().endsWith(".gif");
        const isMp4 = file.type === "video/mp4" || file.name?.toLowerCase().endsWith(".mp4");


        if (isGif || isMp4) {
            gifHydrating = true;
            try {
                grid_style = "Echo1536Image";
                img = null;
                animate = true;

                animationImages = isGif
                ? await gifFileToFrameCanvases(file)
                : await mp4FileToFrameCanvases(file, { fps: currentFps, maxW: 480, maxH: 480, maxFrames: 400 });

                pixelatedCanvas = animationImages[0] || null;

                lastGifSig = gifSig();
                await rebuildFramesNow();
            } finally {
                gifHydrating = false;
            }
            startPlayback(currentFps);
            return;
        }

        // Non-GIF: keep original single-image behavior
        img = new Image();
        img.onload = () => {
            processImage(canvasSize, pixelation);
            pixelatedCanvas = img;
            point_colors = frameToPointColors(img);
            groupByColors();
        };
        img.onerror = (e) => console.error("Image load failed", e);
        img.src = URL.createObjectURL(file);
    }

    $effect(() => {
    // Skip if nothing to draw
    if (!previewCanvas) return;

    if (animate && animationImages?.length) {
        // GIF / MP4 mode: update only current frame if not precomputing
        if (!isPrecomputing && !isLoadingGif && !gifHydrating) {
            const frame = animationImages[frameIndex % animationImages.length];
            if (frame) processFramePreview(frame);
        }
    } else if (img) {
        // Static image mode
        processFramePreview(img);
    }

    function processFramePreview(frameImg) {
        const canvas = document.createElement("canvas");
        canvas.width = canvasSize;
        canvas.height = canvasSize;
        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvasSize, canvasSize);

        // --- apply same rotation / zoom / contain logic as processImage ---
        const iw = frameImg.width || frameImg.naturalWidth || canvasSize;
        const ih = frameImg.height || frameImg.naturalHeight || canvasSize;
        const containScale = Math.min(canvasSize / iw, canvasSize / ih);
        const drawW = iw * containScale * zoom;
        const drawH = ih * containScale * zoom;

        ctx.save();
        ctx.translate(canvasSize / 2, canvasSize / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(frameImg, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();

        // --- apply brightness/contrast/saturation ---
        const data = ctx.getImageData(0, 0, canvasSize, canvasSize);
        const buf = new Uint32Array(data.data.buffer);
        const bFactor = brightness / 100;
        const cFactor = contrast / 100;
        const sFactor = saturation / 100;

        for (let i = 0; i < buf.length; i++) {
            let val = buf[i];
            let r = val & 0xff;
            let g = (val >> 8) & 0xff;
            let b = (val >> 16) & 0xff;
            const a = (val >> 24) & 0xff;

            r = (r * bFactor - 128) * cFactor + 128;
            g = (g * bFactor - 128) * cFactor + 128;
            b = (b * bFactor - 128) * cFactor + 128;

            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            r = lum + (r - lum) * sFactor;
            g = lum + (g - lum) * sFactor;
            b = lum + (b - lum) * sFactor;

            buf[i] =
                (a << 24) |
                (Math.max(0, Math.min(255, b)) << 16) |
                (Math.max(0, Math.min(255, g)) << 8) |
                Math.max(0, Math.min(255, r));
        }

        ctx.putImageData(data, 0, 0);

        pixelatedCanvas = canvas; // update preview
    }
});

    
    function handleAnimateFileChange(filname) {
        file = filname;
        if (grid_spacing_mm === "Image") {
            grid_spacing_mm = 1.8;
            point_size = 0.25;
        }
        brightness = 90;
        contrast = 120;
        saturation = 120;
        zoom = 1;
        pixelation = 4;
        rotation = 0;
        whiteBgReplacement = 'Invisible';
        color_mapping = getColorMapping(well_colors, false)
        if (!file) return;
        img = new Image();
        img.onload = () => { processImage(canvasSize, pixelation); };
        img.src = URL.createObjectURL(file);
    }

    
    function processImage(canvasSize, pixelation) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = canvasSize;
        canvas.height = canvasSize;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvasSize, canvasSize);

        if (!img) {
            imageColors = getPixelHexColors(ctx, canvasSize, canvasSize);
            return;
        }

        const iw =
            img instanceof HTMLCanvasElement ? img.width :
            img instanceof HTMLImageElement ? img.naturalWidth :
            img.width ?? 0;

        const ih =
            img instanceof HTMLCanvasElement ? img.height :
            img instanceof HTMLImageElement ? img.naturalHeight :
            img.height ?? 0;

        if (!iw || !ih) {
            imageColors = getPixelHexColors(ctx, canvasSize, canvasSize);
            pixelatedSrc = canvas.toDataURL();
            return;
        }

        // contain-fit size WITHOUT zoom (stable reference)
        const containScale = Math.min(canvasSize / iw, canvasSize / ih);
        const containW = iw * containScale;
        const containH = ih * containScale;

        // apply zoom only to the final draw size
        const drawW = containW * zoom;
        const drawH = containH * zoom;

        // pixelation resolution based on contain size, not zoomed size
        const pixelRes = canvasSize + 4 - pixelation;
        const pxScale = Math.min(pixelRes / containW, pixelRes / containH);

        // temp canvas = pixelated version of the *contain* image
        const tempW = Math.max(1, Math.round(containW * pxScale));
        const tempH = Math.max(1, Math.round(containH * pxScale));

        const temp = document.createElement("canvas");
        temp.width = tempW;
        temp.height = tempH;
        const tctx = temp.getContext("2d");

        tctx.fillStyle = "#ffffff";
        tctx.fillRect(0, 0, tempW, tempH);

        // rotate around temp center (same behavior)
        tctx.save();
        tctx.translate(tempW / 2, tempH / 2);
        tctx.rotate((rotation * Math.PI) / 180);
        tctx.drawImage(img, -tempW / 2, -tempH / 2, tempW, tempH);
        tctx.restore();

        // final draw (apply zoom here)
        ctx.imageSmoothingEnabled = false;

        const dx = (canvasSize - drawW) / 2;
        const dy = (canvasSize - drawH) / 2;
        ctx.drawImage(temp, dx, dy, drawW, drawH);

        //
        const imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
        const buf = new Uint32Array(imageData.data.buffer);

        const bFactor = brightness / 100;
        const cFactor = contrast / 100;
        const sFactor = saturation / 100;

        for (let i = 0; i < buf.length; i++) {
            let val = buf[i];

            let r = val & 0xff;
            let g = (val >> 8) & 0xff;
            let b = (val >> 16) & 0xff;
            const a = (val >> 24) & 0xff;

            r = (r * bFactor - 128) * cFactor + 128;
            g = (g * bFactor - 128) * cFactor + 128;
            b = (b * bFactor - 128) * cFactor + 128;

            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            r = lum + (r - lum) * sFactor;
            g = lum + (g - lum) * sFactor;
            b = lum + (b - lum) * sFactor;

            buf[i] =
            (a << 24) |
            (Math.max(0, Math.min(255, b)) << 16) |
            (Math.max(0, Math.min(255, g)) << 8) |
            Math.max(0, Math.min(255, r));
        }

        ctx.putImageData(imageData, 0, 0);

        pixelatedSrc = canvas.toDataURL();
        imageColors = getPixelHexColors(ctx, canvasSize, canvasSize);
    }

    function formatSeconds(seconds) {
        let totalDuration = 0;
        for (const key in points_by_color) {
            const points = points_by_color[key];
            let curDuration = 0;

            for (let i = 1; i < points.length; i++) {
                const [x1, y1] = points[i - 1].point;
                const [x2, y2] = points[i].point;
                const dx = x2 - x1;
                const dy = y2 - y1;
                // duration: print point
                curDuration += Math.sqrt(dx * dx + dy * dy) / 3.5;
            }
            totalDuration += curDuration;
            // duration: switch pipette
            totalDuration += 19;
            // duration: refill pipette
            totalDuration +=  Math.ceil(points_by_color[key].length / 18) * 4.5;
        }
        seconds = totalDuration;
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function rowLabel1536(n) {
        let s = "";
        n = Math.floor(n);

        while (n >= 0) {
            s = String.fromCharCode((n % 26) + 65) + s;
            n = Math.floor(n / 26) - 1;
        }
        return s;
    }

    function stripAfterLastUnderscore(label) {
        const idx = label.lastIndexOf("_");
        return idx === -1 ? label : label.slice(0, idx);
    }

    function scheduleGroupByColors() {
        if (groupScheduled) return;
        groupScheduled = true;

        requestAnimationFrame(() => {
            groupByColors();
            groupScheduled = false;
        });
    }

    function keyFromEvent(e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || !el.dataset?.key) return null;
        return el.dataset.key.replace(",", ", ");
    }

    function paintKey(key) {
        if (!key || key === lastKey) return;
        lastKey = key;

        if (current_color === "Erase") {
            delete point_colors[key];
        } else {
            point_colors[key] = current_color;
        }

        // make Svelte actually re-render
        point_colors = { ...point_colors };
        scheduleGroupByColors();
    }

    function toggleKey(key) {
        if (!key) return;

        if (point_colors[key]) {
            delete point_colors[key];
        } else {
            if (current_color === "Erase") return;
            point_colors[key] = current_color;
        }

        point_colors = { ...point_colors };
        scheduleGroupByColors();
    }

    function handlePointerDown(e) {
        isPainting = true;
        lastKey = null;

        didMove = false;
        downX = e.clientX;
        downY = e.clientY;

        downKey = keyFromEvent(e);

        e.currentTarget.setPointerCapture?.(e.pointerId);
    }

    function handlePointerMove(e) {
        if (!isPainting) return;

        if (!didMove) {
            const dx = e.clientX - downX;
            const dy = e.clientY - downY;
            if (dx * dx + dy * dy >= DRAG_PX * DRAG_PX) {
                didMove = true;
                paintKey(downKey);
            }
        }

        if (didMove) {
            paintKey(keyFromEvent(e));
        }
    }

    function handlePointerUp(e) {
        isPainting = false;
        lastKey = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);

        if (!didMove) {
            toggleKey(downKey);
        }

        downKey = null;
    }

    function pausePlayback() {
        if (!isPlaying) return;
        isPlaying = false;
        isPaused = true;
    }

    function resumePlayback() {
        if (!isPlaying) return;

        // avoid "fast catch-up" after pause
        lastTs = performance.now();
        isPaused = false;
    }

    function togglePlayback() {
        groupByColors();
        if (!isPlaying) {
            startPlayback(currentFps);
            return;
        }
        if (isPaused) resumePlayback();
        else pausePlayback();
    }

    function stopPlayback() {
        isPlaying = false;
        isPaused = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
    }

function markFramesDirty() {
  if (isPrecomputing) return;
  rebuildFramesNow();
}

async function rebuildFramesNow() {
    if (!animationImages?.length) return;

    if (isPrecomputing) {
        rebuildToken++; // cancels the currently-running rebuild loop
        // wait for the current rebuild to exit its finally{} and clear isPrecomputing
        while (isPrecomputing) await tick();
    }

    const token = ++rebuildToken;
    rebuildProgress = 0;
    rebuildTotal = animationImages.length;
    isPrecomputing = true;

    const newFrames = [];
    grid_style = "Echo1536Image";

    try {
        for (const frameImg of animationImages) {
            if (token !== rebuildToken) {
                console.log("[GIF] canceled at", rebuildProgress, "/", rebuildTotal);
                return;
            }
            const pc = frameToPointColors(frameImg);

            newFrames.push(pc);
            rebuildProgress++;

            await new Promise((r) => setTimeout(r, 0));
        }
        if (token === rebuildToken) {
            animationFrames = newFrames;

            const idx = Math.min(
                scrubIndex,
                animationFrames.length - 1
            );

            frameIndex = idx;
            scrubIndex = idx;
            point_colors = animationFrames[idx];

            if (animationImages?.length) {
                pixelatedCanvas = animationImages[idx];
            }
        }
    } finally {
        if (token === rebuildToken) isPrecomputing = false;
    }
    }


    async function submitGifUrl() {
        const url = (gifUrlInput || "").trim();
        if (!url) return;

        gifUrlStatus = "checking";
        gifUrlError = "";

        try {
            const res = await fetch(url, { mode: "cors" });
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

            const blob = await res.blob();
            const ext = (blob.type || "").split("/")[1] || "png"; // fallback to png
            const file = new File([blob], `remote.${ext}`, { type: blob.type || "image/png" });
            lastLoadedGifUrl = (res.url || "").trim();

            // feed into the exact same upload sequence
            await handleFileChange({ target: { files: [file] } });

            gifUrlStatus = "valid";
        } catch (e) {
            gifUrlStatus = "invalid";
            gifUrlError = String(e?.message || e);
        }
    }

    function gifSig() {
        return [
            canvasSize, pixelation, brightness, contrast, saturation, rotation, zoom,
            whiteBgReplacement,
            mappingVersion,
        ].join("|");
    }

    function randomizeGifColors() {
        color_mapping = getColorMapping(well_colors, true);
        mappingVersion++;
    }

    $effect(() => {
        if (!animate || !animationImages?.length) return;
        if (isPrecomputing || isLoadingGif || gifHydrating) return;

        const sig = gifSig();
        if (sig === lastGifSig) return;
        lastGifSig = sig;

        markFramesDirty();
    });

    function setFrame(i) {
        if (!animationFrames.length) return;

        const idx = Math.max(0, Math.min(animationFrames.length - 1, i | 0));
        scrubIndex = idx;
        frameIndex = idx;

        point_colors = animationFrames[idx];

        if (animationImages?.length) {
            pixelatedCanvas = animationImages[idx];
        }
    }

    function ensureSampleCtx() {
        if (!sampleCanvas) {
            sampleCanvas = document.createElement("canvas");
            sampleCanvas.width = SAMPLE_W;
            sampleCanvas.height = SAMPLE_H;
            sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
            sampleCtx.imageSmoothingEnabled = false;
        }
    }

    function frameToPointColors(frame) {
        ensureSampleCtx();

        const iw = frame?.width ?? 0;
        const ih = frame?.height ?? 0;
        if (!iw || !ih || !points?.length) return {};

        // Clear to white
        sampleCtx.setTransform(1, 0, 0, 1, 0, 0);
        sampleCtx.globalCompositeOperation = "source-over";
        sampleCtx.filter = "none";
        sampleCtx.fillStyle = "#fff";
        sampleCtx.fillRect(0, 0, SAMPLE_W, SAMPLE_H);

        // Apply filters
        sampleCtx.filter =
            `brightness(${brightness / 100}) ` +
            `contrast(${contrast / 100}) ` +
            `saturate(${saturation / 100})`;

        // -- Draw frame
        const baseScale = Math.min(SAMPLE_W / iw, SAMPLE_H / ih) * zoom;
        const drawW = iw * baseScale;
        const drawH = ih * baseScale;

        sampleCtx.save();
        sampleCtx.translate(SAMPLE_W * 0.5, SAMPLE_H * 0.5);
        sampleCtx.rotate((rotation * Math.PI) / 180);
        sampleCtx.drawImage(frame, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
        sampleCtx.restore();

        sampleCtx.filter = "none";

        // Read pixels
        const data = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

        // Echo grid bounds
        const minX = 0, maxX = 127;
        const minY = 0, maxY = 85;
        const invGW = 1 / (maxX - minX + 1); // 1/128
        const invGH = 1 / (maxY - minY + 1); // 1/86

        const out = {};
        const useInvert = !!invertColors;
        const addWhite = (whiteBgReplacement !== "Invisible");

        // precompute these
        const wMinus1 = SAMPLE_W - 1;
        const hMinus1 = SAMPLE_H - 1;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];

            // Normalize grid point -> [0,1)
            const u = ((p.x - minX) + 0.5) * invGW;
            const v = ((p.y - minY) + 0.5) * invGH;

            // ✅ KEY: sample FULL CANVAS coords (not draw rect)
            let sx = ((u * wMinus1) | 0) + 8;
            let sy = ((v * hMinus1) | 0) + 8;

            const di = ((sy * SAMPLE_W + sx) << 2);

            let r = data[di], g = data[di + 1], b = data[di + 2];
            // alpha will basically always be 255 now because we filled white
            if (useInvert) { r = 255 - r; g = 255 - g; b = 255 - b; }

            const hex = rgbToHex(r, g, b);
            const cName = closestNamedColor(hex, current_well_colors, well_colors, color_mapping);

            if (cName !== "White" && cName !== "Erase") {
            out[`${p.x}, ${p.y}`] = cName;
            } else if (addWhite) {
            out[`${p.x}, ${p.y}`] = whiteBgReplacement;
            }
        }

        return out;
    }

    async function mp4FileToFrameCanvases(file, {
        fps = 10,
        maxFrames = 300,
        maxW = 480,
        maxH = 480
        } = {}) {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = "anonymous";
        video.preload = "auto";

        await new Promise((res, rej) => {
            video.onloadedmetadata = () => res();
            video.onerror = () => rej(new Error("MP4 load failed"));
        });

        const dur = video.duration || 0;
        const vw = video.videoWidth || 0;
        const vh = video.videoHeight || 0;
        if (!dur || !vw || !vh) {
            URL.revokeObjectURL(url);
            return [];
        }
    
        const scale = Math.min(1, maxW / vw, maxH / vh);
        const cw = Math.max(1, Math.round(vw * scale));
        const ch = Math.max(1, Math.round(vh * scale));

        const capture = document.createElement("canvas");
        capture.width = cw;
        capture.height = ch;
        const cctx = capture.getContext("2d", { willReadFrequently: true });
        cctx.imageSmoothingEnabled = true;

        const frameCount = Math.min(maxFrames, Math.max(1, Math.floor(dur * fps)));
        const dt = dur / frameCount;

        const out = [];
        for (let i = 0; i < frameCount; i++) {
            const t = Math.min(dur - 0.0001, i * dt);
            await seekVideo(video, t);
            cctx.clearRect(0, 0, cw, ch);
            cctx.drawImage(video, 0, 0, cw, ch);
            const snap = document.createElement("canvas");
            snap.width = cw;
            snap.height = ch;
            snap.getContext("2d").drawImage(capture, 0, 0);
            out.push(snap);
            await new Promise(r => setTimeout(r, 0));
        }

        URL.revokeObjectURL(url);
        return out;
    }

    function seekVideo(video, time) {
        return new Promise((res, rej) => {
            const onSeeked = () => {
                cleanup();
                res();
            };
            const onError = () => {
                cleanup();
                rej(new Error("MP4 seek failed"));
            };
            const cleanup = () => {
                video.removeEventListener("seeked", onSeeked);
                video.removeEventListener("error", onError);
            };

            video.addEventListener("seeked", onSeeked, { once: true });
            video.addEventListener("error", onError, { once: true });
            video.currentTime = time;
        });
    }
</script>

<article class="prose w-full mx-auto mt-5">
    <h2 class="flex justify-center items-center gap-2 text-base-content">
        <svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1514 1527" width="20" height="20" fill="currentColor" >
            <path id="Layer" class="" d="m1151.8 146.1l-11.2 11.2c-22.4 18.7-52.2 26.1-78.3 14.9l-82-33.6c-26.1-11.2-44.7-37.3-44.7-67.1v-18.7c0-29.8-26.1-52.2-52.2-52.2h-227.4c-29.8 0-52.2 22.4-52.2 52.2v18.7c0 29.8-18.6 55.9-44.7 67.1l-82 33.6c-26.1 11.2-59.6 3.8-78.3-14.9l-11.1-11.2c-22.4-18.7-52.2-18.7-74.6 0l-167.7 160.5c-18.7 18.6-22.4 52.2 0 74.6l11.2 11.2c18.6 22.4 26 52.2 14.9 78.4l-33.6 82.1c-11.2 26.1-37.3 44.7-67.1 44.7h-18.6c-29.8 0-52.2 26.2-52.2 52.3v227.6c0 29.9 22.4 52.3 52.2 52.3h18.6c29.8 0 55.9 18.6 67.1 44.7l33.6 82.1c11.1 26.2 3.7 59.8-14.9 78.4l-11.2 11.2c-18.7 22.4-18.7 52.2 0 74.6l160.3 160.5c18.6 18.7 52.1 22.4 74.5 0l11.2-11.2c22.3-18.7 52.2-26.1 78.3-14.9l82 33.6c26.1 11.2 44.7 37.3 44.7 67.1v18.7c0 29.8 26.1 52.2 52.2 52.2h227.4c29.8 0 52.1-22.4 52.1-52.2v-18.7c0-29.8 18.7-55.9 44.8-67.1l82-33.6c26.1-11.2 59.6-3.8 78.2 14.9l11.2 11.2c22.4 18.7 52.2 18.7 74.6 0l52.2-52.2-290.8-291.1c-37.3-37.3-123-123.2-234.8-11.2-33.6 33.6-55.9 78.4-89.5 111.9-78.2 78.4-171.4 41.1-208.7-33.5-22.4-44.8-14.9-48.6-37.3-89.6-26.1-41.1-70.8-70.9-85.7-123.2-11.2-52.2 14.9-67.1 14.9-93.2 0-26.2-26.1-56-18.6-93.3 3.7-29.9 26.1-48.5 29.8-63.5 3.7-14.9 3.7-26.1 7.4-48.5 14.9-67.2 78.3-100.7 134.2-63.4 37.3 26.1 119.3 115.7 130.5 104.5 11.2-11.2-78.3-93.3-104.4-130.6-37.3-56-3.7-123.2 63.4-134.4 22.3-3.7 37.3-3.7 48.4-7.5 15-7.4 29.9-26.1 63.4-29.8 37.3-7.5 70.8 18.7 93.2 18.7 26.1 0 44.7-26.2 93.2-15 52.2 11.2 82 59.7 123 85.9 41 26.1 41 18.6 89.4 37.3 74.6 37.3 115.6 130.6 33.6 208.9-33.6 33.6-78.3 52.3-111.8 89.6-111.9 112-22.4 197.8 11.2 235.1l290.7 291.1 52.2-52.3c18.6-18.6 22.3-52.2 0-74.6l-11.2-11.2c-18.6-22.4-26.1-52.2-14.9-78.4l33.5-82.1c11.2-26.1 37.3-44.7 67.1-44.7h18.7c29.8 0 52.1-26.2 52.1-52.3v-227.6c0-29.9-22.3-52.3-52.1-52.3h-18.7c-29.8 0-55.9-18.6-67.1-44.7l-33.5-82.1c-11.2-26.2-3.7-59.7 14.9-78.4l11.2-11.2c18.6-22.4 18.6-52.2 0-74.6l-160.3-160.5c-3.7-29.9-37.3-29.9-55.9-11.2z"/>
        </svg>
        Automation Art Interface
    </h2>
</article>

<dialog id="upload_modal" class="modal modal-middle">
    <div class="modal-box">
        <h3 class="text-lg font-bold">Ready to publish?</h3>
        <p class="pt-3 flex flex-row gap-2 items-center">
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 256 256" id="Flat" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M63.99805,140.002a7.99955,7.99955,0,0,1-8,8h-.00049l-44.00147-.0039a8,8,0,0,1-6.3955-12.80469A67.81463,67.81463,0,0,1,33.02783,113.5127,39.99241,39.99241,0,1,1,99.29492,76.50293a7.99971,7.99971,0,0,1-3.78515,8.37695,64.36027,64.36027,0,0,0-27.85889,33.7959A63.645,63.645,0,0,0,63.99805,140.002Zm186.39941-4.81054a67.81009,67.81009,0,0,0-27.42676-21.68067A39.99246,39.99246,0,1,0,156.70361,76.5a8.00092,8.00092,0,0,0,3.78467,8.37695,64.367,64.367,0,0,1,27.85938,33.79688A63.64448,63.64448,0,0,1,192,140a8.00039,8.00039,0,0,0,8.001,8l44.001-.00391a8,8,0,0,0,6.39551-12.80468ZM157.16162,178.0896a48,48,0,1,0-58.32324,0,71.66776,71.66776,0,0,0-35.59522,34.40454A7.9997,7.9997,0,0,0,70.43457,223.999H185.56543a8.00017,8.00017,0,0,0,7.19141-11.50488A71.66776,71.66776,0,0,0,157.16162,178.0896Z"></path> </g></svg>
            Publicly viewable
        </p>
        <p class="pt-2 flex flex-row gap-2 items-center">
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 256.00 256.00" id="Flat" xmlns="http://www.w3.org/2000/svg" stroke="#000000" stroke-width="5.12"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M80.34375,115.668A8,8,0,0,1,86,102.01074h34V40a8,8,0,0,1,16,0v62.01074h34a8,8,0,0,1,5.65625,13.65723l-42,41.98926a7.99945,7.99945,0,0,1-11.3125,0ZM216,144a8.00039,8.00039,0,0,0-8,8v56H48V152a8,8,0,0,0-16,0v56a16.01833,16.01833,0,0,0,16,16H208a16.01833,16.01833,0,0,0,16-16V152A8.00039,8.00039,0,0,0,216,144Z"></path> </g></svg>
            Access on any device
        </p>
        <p class="pt-2 flex flex-row gap-2 items-center">
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>robot-arm</title> <path d="M30.663 14.423l-3.593-0.663c-0.221-0.426-0.597-0.774-1.084-0.95-0.061-0.022-0.123-0.041-0.185-0.057l-4.024-7.963c0.382-0.767 0.431-1.684 0.053-2.516-0.672-1.482-2.441-2.128-3.951-1.443l-15.015 6.125c-1.829 0.83-2.652 2.958-1.838 4.753 0.347 0.765 0.935 1.345 1.638 1.696l5.468 13.482 0.232 0.589c-1.059 0.98-1.722 2.382-1.722 3.939h10.734c0-2.964-2.403-5.367-5.367-5.367-0.010 0-0.019 0-0.029 0l-0.383-1.051 0.060 0.015-0.105-0.138-4.383-12.042-0.004-0.051 12.066-6.041 4.238 7.212c-0.006 0.016-0.013 0.031-0.018 0.047-0.033 0.092-0.059 0.185-0.078 0.279l-3.378 2.057 1.136 1.035 1.646 3.513 1.68 0.313-0.683-4.858 0.258-0.155c0.175 0.149 0.38 0.27 0.609 0.353 0.87 0.315 1.817-0.018 2.313-0.751l1.231 4.724 1.468-0.874 0.294-3.442 0.139 0.025 0.579-1.792zM3.867 7.875c1.294-0.214 2.516 0.661 2.73 1.955s-0.661 2.516-1.955 2.73-2.516-0.661-2.73-1.955c-0.214-1.294 0.661-2.516 1.955-2.73zM17.367 3.785c-0.16-0.967 0.494-1.88 1.461-2.040 0.78-0.129 1.524 0.271 1.867 0.938 0.020 0.039 0.038 0.078 0.055 0.118 0.002 0.004 0.003 0.008 0.005 0.011 0.016 0.039 0.031 0.078 0.045 0.119 0 0.001 0.001 0.002 0.001 0.003 0.013 0.039 0.025 0.080 0.035 0.12 0.002 0.009 0.004 0.018 0.006 0.026 0.010 0.041 0.019 0.082 0.025 0.124 0 0 0 0 0 0 0.030 0.181 0.031 0.361 0.007 0.534-0.104 0.749-0.683 1.377-1.468 1.507-0.029 0.005-0.057 0.009-0.085 0.012-0.009 0.001-0.018 0.002-0.027 0.003-0.019 0.002-0.039 0.004-0.058 0.005-0.011 0.001-0.022 0.001-0.032 0.002-0.018 0.001-0.035 0.002-0.052 0.002-0.011 0-0.022 0-0.034 0-0.017 0-0.034-0-0.051-0.001-0.011-0-0.022-0.001-0.033-0.001-0.017-0.001-0.034-0.002-0.051-0.003-0.011-0.001-0.021-0.002-0.032-0.003-0.019-0.002-0.037-0.004-0.055-0.006-0.009-0.001-0.018-0.002-0.027-0.003-0.027-0.004-0.053-0.008-0.080-0.013-0.001-0-0.001-0-0.002-0-0.026-0.005-0.053-0.011-0.079-0.017-0.009-0.002-0.018-0.005-0.027-0.007-0.017-0.004-0.035-0.009-0.052-0.014-0.010-0.003-0.021-0.006-0.031-0.009-0.016-0.005-0.031-0.010-0.047-0.015-0.011-0.004-0.021-0.007-0.032-0.011-0.015-0.005-0.030-0.011-0.045-0.017-0.010-0.004-0.021-0.008-0.031-0.012-0.015-0.006-0.030-0.013-0.045-0.019-0.010-0.004-0.020-0.009-0.029-0.013-0.016-0.007-0.032-0.015-0.048-0.023-0.008-0.004-0.016-0.008-0.024-0.012-0.023-0.012-0.047-0.025-0.069-0.038-0-0-0.001-0-0.001-0.001v0c-0.442-0.257-0.77-0.702-0.86-1.245z"></path> </g></svg>
            Cloud Lab Printable
        </p>
        <div class="flex flex-col w-full gap-2 pt-5 max-w-[85%] mx-auto">
            <label class="input input-bordered flex items-center gap-2 text-sm">
                <svg class="h-4 w-4 opacity-70" fill="currentColor" height="200px" width="200px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" enable-background="new 0 0 512 512" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M46.5,0v139.6h23.3c0-23.3,0-69.8,23.3-93.1c23.2-23.3,46.5-23.3,69.8-23.3h46.5v395.6c0,34.9-11.6,69.8-46.5,69.8l-22.8,0 l-0.5,23.2h232.7v-23.3h-23.3c-34.9,0-46.5-34.9-46.5-69.8V23.3h46.5c23.3,0,46.5,0,69.8,23.3s23.3,69.8,23.3,93.1h23.3V0H46.5z"></path> </g></svg>
                <input type="text" class="rounded-sm grow no-autofill px-1 py-0.5" placeholder="Title" autocomplete="off" maxlength="100" bind:value={title} />
            </label>
            <!-- <label class="input input-bordered flex items-center gap-2">
                <svg class="h-4 w-4 opacity-70" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M8 7C9.65685 7 11 5.65685 11 4C11 2.34315 9.65685 1 8 1C6.34315 1 5 2.34315 5 4C5 5.65685 6.34315 7 8 7Z" fill="currentColor"></path> <path d="M14 12C14 10.3431 12.6569 9 11 9H5C3.34315 9 2 10.3431 2 12V15H14V12Z" fill="#000000"></path> </g></svg>
                <input type="text" class="grow no-autofill" placeholder="Name (optional)" autocomplete="off" maxlength="25" bind:value={author} />
            </label> -->
            <label class="input input-bordered flex items-center gap-2 text-sm">
                <svg class="h-4 w-4 opacity-70" viewBox="0 -2 20 20" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>twitter</title> <desc></desc> <defs> </defs> <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"> <g id="Dribbble-Light-Preview" transform="translate(-60.000000, -7521.000000)" fill="#fff"> <g id="icons" transform="translate(56.000000, 160.000000)"> <path d="M10.29,7377 C17.837,7377 21.965,7370.84365 21.965,7365.50546 C21.965,7365.33021 21.965,7365.15595 21.953,7364.98267 C22.756,7364.41163 23.449,7363.70276 24,7362.8915 C23.252,7363.21837 22.457,7363.433 21.644,7363.52751 C22.5,7363.02244 23.141,7362.2289 23.448,7361.2926 C22.642,7361.76321 21.761,7362.095 20.842,7362.27321 C19.288,7360.64674 16.689,7360.56798 15.036,7362.09796 C13.971,7363.08447 13.518,7364.55538 13.849,7365.95835 C10.55,7365.79492 7.476,7364.261 5.392,7361.73762 C4.303,7363.58363 4.86,7365.94457 6.663,7367.12996 C6.01,7367.11125 5.371,7366.93797 4.8,7366.62489 L4.8,7366.67608 C4.801,7368.5989 6.178,7370.2549 8.092,7370.63591 C7.488,7370.79836 6.854,7370.82199 6.24,7370.70483 C6.777,7372.35099 8.318,7373.47829 10.073,7373.51078 C8.62,7374.63513 6.825,7375.24554 4.977,7375.24358 C4.651,7375.24259 4.325,7375.22388 4,7375.18549 C5.877,7376.37088 8.06,7377 10.29,7376.99705" id="twitter-[#154]"> </path> </g> </g> </g> </g></svg>
                <input type="text" class="rounded-sm grow no-autofill px-1 py-0.5" placeholder="Twitter (optional)" autocomplete="off" maxlength="100" bind:value={author} />
            </label>
        </div>

        <!-- <p class="pt-4 flex flex-row gap-2 items-center justify-center italic text-xs opacity-70">
            Note: designs are located in the 'All' tab until approved by an admin.
        </p> -->

        <div class="modal-action">
            <form method="dialog">
                <button type="button" class="btn" onclick={saveToGallery}>
                    {#if !uploading}
                        <svg class="w-5 h-5" fill="currentColor" viewBox="0 -1.5 35 35" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>upload1</title> <path d="M29.426 15.535c0 0 0.649-8.743-7.361-9.74-6.865-0.701-8.955 5.679-8.955 5.679s-2.067-1.988-4.872-0.364c-2.511 1.55-2.067 4.388-2.067 4.388s-5.576 1.084-5.576 6.768c0.124 5.677 6.054 5.734 6.054 5.734h9.351v-6h-3l5-5 5 5h-3v6h8.467c0 0 5.52 0.006 6.295-5.395 0.369-5.906-5.336-7.070-5.336-7.070z"></path> </g></svg>
                    {:else}
                        <span class="loading loading-spinner loading-xs"></span>
                    {/if}
                    Publish
                </button>
            </form>
        </div>
    </div>
    <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
</dialog>

<dialog id="download_modal" class="modal modal-middle">
    <div class="modal-box">
        <h3 class="text-lg font-bold ">Downloads</h3>
        <div class="flex flex-col gap-2 pt-5">
            <button class="btn btn-sm rounded bg-gray-100 gap-2 hover:bg-neutral hover:text-white" onclick={() => {scriptType="96_deep_well"; downloadPythonFile();}}>
                <svg class="w-5 h-5 inline-block align-middle" transform="scale(1.3) translate(-0.5 0)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"> <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 5v8.5m0 0l3-3m-3 3l-3-3M5 15v2a2 2 0 002 2h10a2 2 0 002-2v-2" /></svg>
                96 Deep-Well Plate
            </button>
            <button class="btn btn-sm rounded bg-gray-100 gap-2 hover:bg-neutral hover:text-white" onclick={() => {scriptType="96_pcr"; downloadPythonFile();}}>
                <svg class="w-5 h-5 inline-block align-middle" transform="scale(1.3) translate(-0.5 0)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"> <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 5v8.5m0 0l3-3m-3 3l-3-3M5 15v2a2 2 0 002 2h10a2 2 0 002-2v-2" /></svg>
                96 PCR Plate
            </button>
        </div>
    </div>
    <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
</dialog>

<dialog id="download_echo_csv" class="modal modal-middle">
    <div class="modal-box">
        <div class="mx-auto text-center font-bold pb-3">Edit Parameters</div>
        <div class="flex w-full gap-4 justify-center">
            <div class="flex flex-col gap-2 text-xs w-[150px]">
                <div>
                    <div class="fieldset-legend pb-1">Echo Source</div>
                    <input
                        type="number"
                        class="input input-sm outline outline-[1px] no-spinner w-full"
                        placeholder="ID #"
                        bind:value={source_id}
                    />
                </div>

                <label class="flex flex-col gap-1">
                    Starting Column
                    <input
                        type="number"
                        class="input input-sm outline outline-[1px] text-center w-full"
                        min="1"
                        max="24"
                        step="1"
                        bind:value={starting_column}
                    />
                </label>
            </div>

            <div class="flex flex-col gap-2 text-xs w-[150px]">
                <div>
                    <div class="fieldset-legend pb-1">Echo Destination</div>
                    <input
                        type="number"
                        class="input input-sm outline outline-[1px] no-spinner w-full"
                        placeholder="ID #"
                        bind:value={destination_id}
                    />
                </div>

                <label class="flex flex-col gap-1">
                    Working Volume (μL)
                    <input
                        type="number"
                        class="input input-sm outline outline-[1px] text-center w-full"
                        min="1"
                        max="60"
                        step="1"
                        bind:value={working_echo_volume_ul}
                    />
                </label>
            </div>
        </div>
        <div class="flex flex-row gap-2 pt-5 justify-center">
            <button class="btn btn-sm rounded bg-content-primary gap-1" onclick={() => {downloadEchoCSV(false);}}>
                <svg class="w-5 h-5 inline-block align-middle" transform="scale(1.3) translate(-0.5 0)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"> <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 5v8.5m0 0l3-3m-3 3l-3-3M5 15v2a2 2 0 002 2h10a2 2 0 002-2v-2" /></svg>
                Echo CSV
            </button>
            <button class="btn btn-sm rounded bg-content-primary gap-1" onclick={() => {downloadEchoCSV(true);}}>
                <svg class="w-5 h-5 inline-block align-middle" transform="scale(1.3) translate(-0.5 0)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"> <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 5v8.5m0 0l3-3m-3 3l-3-3M5 15v2a2 2 0 002 2h10a2 2 0 002-2v-2" /></svg>
                Catalyst CSV
            </button>
        </div>
    </div>
    <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
</dialog>
{#if isToastVisible}
    <div role="alert" class="alert {alertType} fixed top-4 left-1/2 -translate-x-1/2 z-20 text-white max-w-[80%] flex px-4 py-2 rounded shadow-lg items-center">
        {#if alertType === 'alert-success'}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        {:else if alertType === 'alert-warning'}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        {:else}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        {/if}
        <span>{alertMessage}</span>
    </div>
{/if}

<!-- MENU BAR -->
<div class="flex flex-row w-full max-w-[100vw] sm:max-w-[490px] mx-auto px-5 pt-3">
    <div class="mr-auto items-center flex flex-row gap-2 opacity-70">
        <label class="swap mr-auto">
            <input type="checkbox" id="toggle-outlines" bind:checked={show_outlines} />
            <svg class="swap-on w-6 h-6 opacity-70" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g data-name="Layer 2"> <g data-name="eye"> <rect width="24" height="24" opacity="0"></rect> <circle cx="12" cy="12" r="1.5"></circle> <path d="M21.87 11.5c-.64-1.11-4.16-6.68-10.14-6.5-5.53.14-8.73 5-9.6 6.5a1 1 0 0 0 0 1c.63 1.09 4 6.5 9.89 6.5h.25c5.53-.14 8.74-5 9.6-6.5a1 1 0 0 0 0-1zm-9.87 4a3.5 3.5 0 1 1 3.5-3.5 3.5 3.5 0 0 1-3.5 3.5z"></path> </g> </g> </g></svg>
            <svg class="swap-off w-6 h-6 opacity-70" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g data-name="Layer 2"> <g data-name="eye-off"> <rect width="24" height="24" opacity="0"></rect> <circle cx="12" cy="12" r="1.5"></circle> <path d="M15.29 18.12L14 16.78l-.07-.07-1.27-1.27a4.07 4.07 0 0 1-.61.06A3.5 3.5 0 0 1 8.5 12a4.07 4.07 0 0 1 .06-.61l-2-2L5 7.87a15.89 15.89 0 0 0-2.87 3.63 1 1 0 0 0 0 1c.63 1.09 4 6.5 9.89 6.5h.25a9.48 9.48 0 0 0 3.23-.67z"></path> <path d="M8.59 5.76l2.8 2.8A4.07 4.07 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 4.07 4.07 0 0 1-.06.61l2.68 2.68.84.84a15.89 15.89 0 0 0 2.91-3.63 1 1 0 0 0 0-1c-.64-1.11-4.16-6.68-10.14-6.5a9.48 9.48 0 0 0-3.23.67z"></path> <path d="M20.71 19.29L19.41 18l-2-2-9.52-9.53L6.42 5 4.71 3.29a1 1 0 0 0-1.42 1.42L5.53 7l1.75 1.7 7.31 7.3.07.07L16 17.41l.59.59 2.7 2.71a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42z"></path> </g> </g> </g></svg>
        </label>
        <label class="swap mr-auto">
            <input type="checkbox" id="toggle-mode" disabled={Object.keys(point_colors).length > 0} class="{Object.keys(point_colors).length > 0 ? 'tooltip tooltip-top' : ''}" data-tip="Erase Grid to Change" onclick={() => {if (ginkgo_mode) {grid_style = 'Standard'} else {grid_style = 'Echo1536'}; ginkgo_mode = !ginkgo_mode;}} />
            <svg class="swap-on w-5 h-5 opacity-75" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="16" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="16" r="1" fill="currentColor" stroke="none" /></svg>
            <svg class="swap-off w-5 h-5 opacity-75" fill="currentColor" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M 7.7148 49.5742 L 48.2852 49.5742 C 53.1836 49.5742 55.6446 47.1367 55.6446 42.3086 L 55.6446 13.6914 C 55.6446 8.8633 53.1836 6.4258 48.2852 6.4258 L 7.7148 6.4258 C 2.8398 6.4258 .3554 8.8398 .3554 13.6914 L .3554 42.3086 C .3554 47.1602 2.8398 49.5742 7.7148 49.5742 Z M 4.1288 13.8789 C 4.1288 11.4414 5.4413 10.1992 7.7851 10.1992 L 18.1210 10.1992 L 18.1210 19.8555 L 4.1288 19.8555 Z M 21.6601 19.8555 L 21.6601 10.1992 L 34.2460 10.1992 L 34.2460 19.8555 Z M 37.7851 19.8555 L 37.7851 10.1992 L 48.2147 10.1992 C 50.5350 10.1992 51.8708 11.4414 51.8708 13.8789 L 51.8708 19.8555 Z M 21.8241 32.8398 L 21.8241 23.1602 L 34.4101 23.1602 L 34.4101 32.8398 Z M 37.7851 32.8398 L 37.7851 23.1602 L 51.8708 23.1602 L 51.8708 32.8398 Z M 18.1210 23.1602 L 18.1210 32.8398 L 4.1288 32.8398 L 4.1288 23.1602 Z M 48.2147 45.8008 L 37.7851 45.8008 L 37.7851 36.1445 L 51.8708 36.1445 L 51.8708 42.1211 C 51.8708 44.5586 50.5350 45.8008 48.2147 45.8008 Z M 7.7851 45.8008 C 5.4413 45.8008 4.1288 44.5586 4.1288 42.1211 L 4.1288 36.1445 L 18.1210 36.1445 L 18.1210 45.8008 Z M 21.6601 36.1445 L 34.2460 36.1445 L 34.2460 45.8008 L 21.6601 45.8008 Z"></path></g></svg>
        </label>
        {#if current_point.x != null && current_point.y != null}
            {roundPoint(current_point.x)}, {roundPoint(current_point.y)}
            <div class="div text-xs" style="color: {well_colors[point_colors[`${current_point.x}, ${current_point.y}`]]};">{hover_point}</div>
        {/if}
    </div>
    {#if ginkgo_mode}
        <a href='/gallery' class="mr-0 flex flex-row gap-2 items-center opacity-70 text-sm"> Gallery <svg class="w-5 h-5" fill="currentColor" viewBox="0 -0.5 33 33" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>pictures1</title> <path d="M26.604 29.587l-2.624-0.72-0.006-7.258 2.51 0.706 3.619-13.509-18.332-4.912-1.208 4.506h-2.068l1.863-6.952 22.193 5.946-5.947 22.193zM23.039 32h-23.039v-22.977h23.039v22.977zM21.041 11.021h-19.043v13.985h19.043v-13.985zM7.849 20.993l2.283-3.692 2.283 2.301 3.139-4.727 3.283 8.134h-14.556l1.855-3.71 1.713 1.694zM6.484 17.086c-0.828 0-1.499-0.67-1.499-1.498s0.671-1.498 1.499-1.498 1.498 0.67 1.498 1.498-0.67 1.498-1.498 1.498z"></path> </g></svg></a>
    {:else}
        <a href='/gallery?htgaa=true' class="mr-0 flex flex-row gap-2 items-center opacity-70 text-sm"> Gallery <svg class="w-5 h-5" fill="currentColor" viewBox="0 -0.5 33 33" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>pictures1</title> <path d="M26.604 29.587l-2.624-0.72-0.006-7.258 2.51 0.706 3.619-13.509-18.332-4.912-1.208 4.506h-2.068l1.863-6.952 22.193 5.946-5.947 22.193zM23.039 32h-23.039v-22.977h23.039v22.977zM21.041 11.021h-19.043v13.985h19.043v-13.985zM7.849 20.993l2.283-3.692 2.283 2.301 3.139-4.727 3.283 8.134h-14.556l1.855-3.71 1.713 1.694zM6.484 17.086c-0.828 0-1.499-0.67-1.499-1.498s0.671-1.498 1.499-1.498 1.498 0.67 1.498 1.498-0.67 1.498-1.498 1.498z"></path> </g></svg></a>
    {/if}
</div>

<!-- AGAR PLATE -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mb-2 flex items-center mx-auto w-full max-w-[94vw] sm:max-w-[460px] ${(grid_style === 'Echo384' || grid_style === 'Echo384Image' || grid_style === "Echo1536" || grid_style === "Echo1536Image") ? 'aspect-[3/2] mt-4' : 'aspect-square'} rounded-xl">
<div class={`touch-none relative border border-neutral mx-auto w-full max-w-[90vw] 
          sm:max-w-[440px]
          ${grid_style === "Echo384" || grid_style === "Echo384Image" || grid_style === "Echo1536" || grid_style === "Echo1536Image"
            ? 'aspect-[128/86] rounded' 
            : 'aspect-square rounded-full max-h-[90vw] sm:max-h-[440px]'}
          ${loadingURLRecord || loadingAIRecord ? 'blur' : ''}`}
            onmousedown={() => isDrawing = true}
            onmouseup={() => isDrawing = false}
            onmouseleave={() => { isDrawing = false; current_point = {}; }}
            ontouchstart={() => isDrawing = true}
            ontouchend={() => isDrawing = false}
            ontouchcancel={() => isDrawing = false}
            draggable="false"
            id="grid-container"
            onpointerdown={handlePointerDown}
            onpointermove={handlePointerMove}
            onpointerup={handlePointerUp}
            onpointercancel={handlePointerUp}
            onpointerleave={handlePointerUp}
        >
        {#if grid_style === 'QRCode' && QRCode_text === ''} <div class="flex justify-center items-center h-full opacity-40 text-white">Insert text below</div> {/if}
        
        {#each points as { x, y }}
            <!-- svelte-ignore a11y_mouse_events_have_key_events -->
            <input type="checkbox" id="dot-{x}-{y}" data-key={`${x},${y}`}
                class="checkbox
                    {point_size === 0.25 ? 'w-[3px] h-[3px]' : ''}
                    {point_size === 0.5 ? 'w-[6px] h-[6px]' : ''}
                    {point_size === 0.75 ? 'w-[7px] h-[7px]' : ''}
                    {point_size === 1 ? 'w-[8px] h-[8px]' : ''}
                    {point_size === 1.25 ? 'w-[9px] h-[9px]' : ''}
                    {point_size === 1.5 ? 'w-[10px] h-[10px]' : ''}
                    {point_size === 1.75 ? 'w-[11px] h-[11px]' : ''}
                    {point_size === 2 ? 'w-[12px] h-[12px]' : ''} 
                    {point_size === 2.25 ? 'w-[13px] h-[13px]' : ''}
                    {point_size === 2.5 ? 'w-[14px] h-[14px]' : ''} 
                    {point_size === 2.75 ? 'w-[15px] h-[15px]' : ''}
                    {point_size === 3 ? 'w-[16px] h-[16px]' : ''}
                    absolute {grid_style === 'Echo384' || grid_style === 'Echo384Image' || grid_style === "Echo1536" || grid_style === "Echo1536Image" ? '' : 'rounded-full'} [--chkfg:invisible] transition-[box-shadow] duration-200 ease-in-out {point_colors[`${x}, ${y}`] ? 'border-0' : 'opacity-10'} {!show_outlines ? 'border-0' : point_colors[`${x}, ${y}`] ? 'border-1' : 'border border-white opacity-10'}"
                    style="
                    left: {
                        (grid_style === 'Echo384' || grid_style === 'Echo384Image')
                            ? (x / 128 * 105 + 2.8) + '%'
                        : (grid_style === 'Echo1536' || grid_style === 'Echo1536Image')
                            ? (x / 128 * 105 + 1.68) + '%'
                        : (50.5 + x / (radius_mm + 4) * 50) + '%'
                    };
                    top: {
                        (grid_style === 'Echo384' || grid_style === 'Echo384Image')
                            ? (y / 86 * 105 + 4.1) + '%'
                        : (grid_style === 'Echo1536' || grid_style === 'Echo1536Image')
                            ? (y / 86 * 105 + 2.65) + '%'
                        : (50.5 - y / (radius_mm + 4) * 50) + '%'
                    };
                    transform: translate(-50%, -50%);
                    background-color: {well_colors[point_colors[`${x}, ${y}`]] || old_well_colors[point_colors[`${x}, ${y}`]] || 'transparent'};
                    border: {!show_outlines ? 'none' : well_colors[point_colors[`${x}, ${y}`]] ? `1px solid ${well_colors[point_colors[`${x}, ${y}`]]}` : '1px solid white'};
                    "
                draggable="false"
                onmouseover={() => { current_point = {x, y}; hover_point = point_colors[`${x}, ${y}`] }}
            />
        {/each}
        <!-- TIME ESTIMATION -->
        {#if Object.keys(point_colors).length > 0 && grid_style !== "Echo384" && grid_style !== "Echo384Image" && grid_style !== "Echo1536" && grid_style !== "Echo1536Image"}
            <div class="flex flex-row items-center gap-1 justify-center align-middle absolute top-0 left-0 origin-bottom-left opacity-50 tooltip tooltip-bottom" data-tip="Estimated Print Duration" transition:fade={{ duration: 200 }}>
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M23 12C23 18.0751 18.0751 23 12 23C5.92487 23 1 18.0751 1 12C1 5.92487 5.92487 1 12 1C18.0751 1 23 5.92487 23 12ZM3.00683 12C3.00683 16.9668 7.03321 20.9932 12 20.9932C16.9668 20.9932 20.9932 16.9668 20.9932 12C20.9932 7.03321 16.9668 3.00683 12 3.00683C7.03321 3.00683 3.00683 7.03321 3.00683 12Z" fill="currentColor"></path> <path d="M12 5C11.4477 5 11 5.44771 11 6V12.4667C11 12.4667 11 12.7274 11.1267 12.9235C11.2115 13.0898 11.3437 13.2343 11.5174 13.3346L16.1372 16.0019C16.6155 16.278 17.2271 16.1141 17.5032 15.6358C17.7793 15.1575 17.6155 14.5459 17.1372 14.2698L13 11.8812V6C13 5.44772 12.5523 5 12 5Z" fill="currentColor"></path> </g></svg>
                <div class="">{formatSeconds(estimatedPrintDuration)}</div>
            </div>
        {/if}
        <!-- MOVEMENT KEYS -->
        {#if Object.keys(point_colors).length > 0 && grid_style !== "Echo384" && grid_style !== "Echo384Image" && grid_style !== "Echo1536" && grid_style !== "Echo1536Image"}
            <div class="absolute bottom-0 right-0 scale-[60%] origin-bottom-right" transition:fade={{ duration: 200 }}>
                <div class="flex w-full justify-center">
                    <button class="kbd" onclick={() => {point_colors = shiftPoints("up", grid_spacing_mm, grid_spacing_mm, radius_mm, point_colors, grid_style); groupByColors();}}>▲</button>
                </div>
                <div class="flex w-full justify-center gap-2 pt-2">
                    <button class="kbd" onclick={() => {point_colors = shiftPoints("left", grid_spacing_mm, grid_spacing_mm, radius_mm, point_colors, grid_style); groupByColors();}}>◀︎</button>
                    <button class="kbd" onclick={() => {point_colors = shiftPoints("down", grid_spacing_mm, grid_spacing_mm, radius_mm, point_colors, grid_style); groupByColors();}}>▼</button>
                    <button class="kbd" onclick={() => {point_colors = shiftPoints("right", grid_spacing_mm, grid_spacing_mm, radius_mm, point_colors, grid_style); groupByColors();}}>▶︎</button>
                </div>
            </div>
        {/if}
    </div>
</div>


<div class="flex flex-col px-5 gap-1 w-full max-w-[96vw] sm:max-w-[480px] mx-auto mb-[150px]">

    <div class="flex flex-row justify-between">
       {#if (animate && (isPrecomputing || animationFrames.length > 0)) || (!animate && Object.keys(point_colors).length > 0)}
            <!-- ERASE/PUBLISH BUTTON -->
            <div class="flex flex-row gap-2 mt-1 mb-2" in:fade={{ duration: 300 }}>
                <button class="btn btn-sm rounded gap-1 bg-neutral-700 text-base-content hover:bg-neutral-600 hover:text-base-content" onclick={() => { if (!uploading) {upload_modal.showModal()}}}>
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 35 35" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>upload1</title> <path d="M29.426 15.535c0 0 0.649-8.743-7.361-9.74-6.865-0.701-8.955 5.679-8.955 5.679s-2.067-1.988-4.872-0.364c-2.511 1.55-2.067 4.388-2.067 4.388s-5.576 1.084-5.576 6.768c0.124 5.677 6.054 5.734 6.054 5.734h9.351v-6h-3l5-5 5 5h-3v6h8.467c0 0 5.52 0.006 6.295-5.395 0.369-5.906-5.336-7.070-5.336-7.070z"></path> </g></svg>
                    Publish
                </button>
            </div>
            {#if animate}
                <button class="btn btn-sm rounded gap-1 mt-1 mb-2 bg-neutral-700 text-base-content hover:bg-neutral-600 hover:text-base-content ml-auto" onclick={togglePlayback} in:fade={{ duration: 300 }}>
                    {#if isPrecomputing}
                        {rebuildProgress}/{rebuildTotal}
                    {:else if isPlaying && !isPaused}
                        <svg class="w-5 h-5" fill="#fff" viewBox="0 0 24 24" id="pause" data-name="Flat Color" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path id="primary" d="M19,4V20a2,2,0,0,1-2,2H15a2,2,0,0,1-2-2V4a2,2,0,0,1,2-2h2A2,2,0,0,1,19,4ZM9,2H7A2,2,0,0,0,5,4V20a2,2,0,0,0,2,2H9a2,2,0,0,0,2-2V4A2,2,0,0,0,9,2Z" style="fill: #fff;"></path></g></svg>
                    {:else}
                        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M8.286 3.407A1.5 1.5 0 0 0 6 4.684v14.632a1.5 1.5 0 0 0 2.286 1.277l11.888-7.316a1.5 1.5 0 0 0 0-2.555L8.286 3.407z" fill="#fff"></path></g></svg>
                    {/if}
                </button>
            {/if}
            <button class="btn btn-sm rounded gap-1 mt-1 mb-2 bg-neutral-700 text-base-content hover:bg-neutral-600 hover:text-base-content ml-auto" onclick={resetValues} in:fade={{ duration: 300 }}>
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path transform="scale(1.2) translate(-3 -2.5)" fill-rule="evenodd" clip-rule="evenodd" d="M15.0722 3.9967L20.7508 9.83395L17.0544 13.5304L13.0758 17.5H21.0041V19H7.93503L4.00195 15.0669L15.0722 3.9967ZM10.952 17.5L15.4628 12.9994L11.8268 9.3634L6.12327 15.0669L8.55635 17.5H10.952Z" fill="currentColor"></path> </g></svg>
                Erase All
            </button>
        {/if}
    </div>
    
    {#if grid_style === 'QRCode'}
        <div class="relative w-full">
            <svg class="w-5 h-5 absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none opacity-75" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M16.4437 2.00021C14.9719 1.98733 13.5552 2.55719 12.4986 3.58488L12.4883 3.59504L11.6962 4.38801C11.3059 4.77876 11.3063 5.41192 11.697 5.80222C12.0878 6.19252 12.721 6.19216 13.1113 5.80141L13.8979 5.01386C14.5777 4.35511 15.4855 3.99191 16.4262 4.00014C17.3692 4.00839 18.2727 4.38923 18.9416 5.06286C19.6108 5.73671 19.9916 6.64971 19.9998 7.6056C20.008 8.55874 19.6452 9.47581 18.9912 10.1607L16.2346 12.9367C15.8688 13.3052 15.429 13.5897 14.9453 13.7714C14.4616 13.9531 13.945 14.0279 13.4304 13.9907C12.9159 13.9536 12.4149 13.8055 11.9616 13.5561C11.5083 13.3067 11.1129 12.9617 10.8027 12.5441C10.4734 12.1007 9.847 12.0083 9.40364 12.3376C8.96029 12.6669 8.86785 13.2933 9.19718 13.7367C9.67803 14.384 10.2919 14.9202 10.9975 15.3084C11.7032 15.6966 12.4838 15.9277 13.2866 15.9856C14.0893 16.0435 14.8949 15.9268 15.6486 15.6437C16.4022 15.3606 17.0861 14.9177 17.654 14.3457L20.4168 11.5635L20.429 11.551C21.4491 10.4874 22.0125 9.0642 21.9997 7.58834C21.987 6.11247 21.3992 4.69931 20.3607 3.65359C19.3221 2.60764 17.9155 2.01309 16.4437 2.00021Z" fill="#000000"></path> <path d="M10.7134 8.01444C9.91064 7.95655 9.10506 8.0732 8.35137 8.35632C7.59775 8.63941 6.91382 9.08232 6.34597 9.65431L3.5831 12.4365L3.57097 12.449C2.5508 13.5126 1.98748 14.9358 2.00021 16.4117C2.01295 17.8875 2.60076 19.3007 3.6392 20.3464C4.67787 21.3924 6.08439 21.9869 7.55623 21.9998C9.02807 22.0127 10.4447 21.4428 11.5014 20.4151L11.5137 20.4029L12.3012 19.6099C12.6903 19.218 12.6881 18.5849 12.2962 18.1957C11.9043 17.8066 11.2712 17.8088 10.882 18.2007L10.1011 18.9871C9.42133 19.6452 8.51402 20.0081 7.57373 19.9999C6.63074 19.9916 5.72728 19.6108 5.05834 18.9371C4.38918 18.2633 4.00839 17.3503 4.00014 16.3944C3.99191 15.4412 4.35479 14.5242 5.00874 13.8393L7.76537 11.0633C8.13118 10.6948 8.57097 10.4103 9.05467 10.2286C9.53836 10.0469 10.0549 9.97215 10.5695 10.0093C11.0841 10.0464 11.585 10.1945 12.0383 10.4439C12.4917 10.6933 12.887 11.0383 13.1972 11.4559C13.5266 11.8993 14.1529 11.9917 14.5963 11.6624C15.0397 11.3331 15.1321 10.7067 14.8028 10.2633C14.3219 9.61599 13.708 9.07982 13.0024 8.69161C12.2968 8.30338 11.5161 8.07233 10.7134 8.01444Z" fill="#000000"></path> </g></svg>
            <input type="text" placeholder="QR Code" class="input input-bordered w-full input-sm pl-8 rounded focus:outline-none focus:ring-0" bind:value={QRCode_text} maxlength="500" />
        </div>
    {/if}

    {#if grid_style === 'Image' || grid_style === 'Echo384Image' || grid_style === 'Echo1536Image'}
        <div class="flex flex-row w-full items-center mx-auto">
            <input type="file" id="gif-upload" class="hidden" onchange={handleFileChange} />
            <div class="join w-full">
                <label for="gif-upload" class="btn btn-sm btn-primary join-item">
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M23 4C23 2.34315 21.6569 1 20 1H4C2.34315 1 1 2.34315 1 4V20C1 21.6569 2.34315 23 4 23H20C21.6569 23 23 21.6569 23 20V4ZM21 4C21 3.44772 20.5523 3 20 3H4C3.44772 3 3 3.44772 3 4V20C3 20.5523 3.44772 21 4 21H20C20.5523 21 21 20.5523 21 20V4Z" fill="#0F0F0F"></path> <path d="M4.80665 17.5211L9.1221 9.60947C9.50112 8.91461 10.4989 8.91461 10.8779 9.60947L14.0465 15.4186L15.1318 13.5194C15.5157 12.8476 16.4843 12.8476 16.8682 13.5194L19.1451 17.5039C19.526 18.1705 19.0446 19 18.2768 19H5.68454C4.92548 19 4.44317 18.1875 4.80665 17.5211Z" fill="#0F0F0F"></path> <path d="M18 8C18 9.10457 17.1046 10 16 10C14.8954 10 14 9.10457 14 8C14 6.89543 14.8954 6 16 6C17.1046 6 18 6.89543 18 8Z" fill="#0F0F0F"></path> </g></svg>
                    Select
                </label>   
                <input
                    class="input input-sm join-item w-full bg-neutral-700 text-white"
                    placeholder="https://example.com/image.gif"
                    bind:value={gifUrlInput}
                    class:input-success={gifUrlStatus === "valid"}
                    class:input-error={gifUrlStatus === "invalid"}
                />
                <button
                    class="btn btn-sm btn-primary join-item"
                    onclick={submitGifUrl}
                >
                Submit
            </button>
        </div>
        </div>
        {#if animate}
            <div class="flex items-center w-full gap-2 mt-2">
                <input
                type="range"
                min="0"
                max={Math.max(0, (animationFrames?.length ?? 0) - 1)}
                step="1"
                bind:value={scrubIndex}
                class="range range-xs gif-scrubber flex-1"
                disabled={!animationFrames?.length}
                oninput={() => {
                    if (!animationFrames?.length) return;
                    isScrubbing = true;
                    pausePlayback();
                    setFrame(+scrubIndex);
                }}
                onchange={() => {
                    if (!animationFrames?.length) return;
                    isScrubbing = false;
                    setFrame(+scrubIndex);
                }}
                />

                <div class="text-xs opacity-70 whitespace-nowrap">
                {animationFrames?.length ? (scrubIndex + 1) : 0} / {animationFrames?.length ?? 0}
                </div>
            </div>
        {/if}

        <div class="flex flex-row w-full mr-auto items-center">        
            {#if !pixelatedSrc}
                <div class="w-full text-center">
                    <span class="opacity-70 text-[9px] leading-tight leading-[1.5] block break-words pt-1">
                        white background works best <br />
                        contrast & saturation = colorful results
                    </span>
                </div>
            {/if}
        </div>
        {#if !pixelatedSrc} <div class="pb-3"></div> {/if}
    {/if}

    {#if img || animationImages?.length}
        <div
  class="flex flex-row w-full gap-4 text-xs bg-base-200 rounded px-4 py-4 transition-opacity"
  class:opacity-50={animate && (isPrecomputing || isLoadingGif || gifHydrating)}
  class:pointer-events-none={animate && (isPrecomputing || isLoadingGif || gifHydrating)}
>
            <div class="w-[25%] mx-auto my-auto flex flex-col gap-1">
                {#if img || animationImages?.length}
                    <canvas bind:this={previewCanvas} class="w-full mx-auto outline outline-neutral outline-2 rounded"></canvas>
                {/if}
                <button class="btn btn-xs btn-primary ..." onclick={() => {if (animate) { randomizeGifColors(); } else { color_mapping = getColorMapping(well_colors, true); processImage(canvasSize, pixelation);} }}>Random</button>

                <button class="btn btn-xs btn-primary gap-1 flex items-center text-[9px] sm:text-xs" onclick={() => {color_mapping = getColorMapping(well_colors, false); brightness = 90; contrast = 120; saturation = 120; zoom = 1; pixelation = 4; rotation = 0; processImage(canvasSize, pixelation);}}>
                    <svg class="w-3 h-3 sm:w-4 sm:h-4"  viewBox="-0.5 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M18.8887 10.25C18.5395 10.2462 18.1974 10.151 17.8964 9.97387C17.5954 9.79677 17.3461 9.54393 17.1731 9.24053C17.0002 8.93714 16.9097 8.59372 16.9107 8.2445C16.9117 7.89528 17.0041 7.55241 17.1787 7.24999L17.2987 7.03997C17.4297 6.81781 17.5133 6.57097 17.5443 6.31493C17.5753 6.0589 17.553 5.79924 17.4788 5.55224C17.4046 5.30524 17.2801 5.07626 17.1132 4.87969C16.9462 4.68312 16.7404 4.52317 16.5087 4.40996V4.40996C16.0227 4.17652 15.467 4.13332 14.9507 4.28875C14.4345 4.44418 13.995 4.78704 13.7187 5.24999V5.24999C13.5404 5.54389 13.2894 5.78686 12.9899 5.9555C12.6903 6.12413 12.3524 6.21276 12.0087 6.21276C11.665 6.21276 11.327 6.12413 11.0275 5.9555C10.728 5.78686 10.4769 5.54389 10.2987 5.24999C10.0224 4.78704 9.58291 4.44418 9.06665 4.28875C8.5504 4.13332 7.99469 4.17652 7.5087 4.40996V4.40996C7.27697 4.52317 7.07116 4.68312 6.90421 4.87969C6.73726 5.07626 6.61277 5.30524 6.53858 5.55224C6.46438 5.79924 6.44209 6.0589 6.47309 6.31493C6.50408 6.57097 6.5877 6.81781 6.71869 7.03997L6.83869 7.24999C7.01332 7.55241 7.10571 7.89528 7.10669 8.2445C7.10767 8.59372 7.01721 8.93714 6.84427 9.24053C6.67134 9.54393 6.42196 9.79677 6.12097 9.97387C5.81999 10.151 5.4779 10.2462 5.12869 10.25C4.64217 10.238 4.16698 10.3979 3.78659 10.7015C3.40621 11.005 3.14493 11.4329 3.04868 11.91C2.99868 12.1996 3.01314 12.4967 3.09101 12.7801C3.16887 13.0635 3.30826 13.3263 3.49921 13.5497C3.69016 13.7731 3.92799 13.9516 4.1958 14.0727C4.46362 14.1937 4.75481 14.2543 5.04868 14.25H5.1687C5.5179 14.2538 5.86 14.349 6.16098 14.5261C6.46196 14.7032 6.71131 14.9561 6.88425 15.2595C7.05718 15.5628 7.14768 15.9063 7.1467 16.2555C7.14572 16.6047 7.05333 16.9476 6.87869 17.25L6.82868 17.33C6.56685 17.7935 6.4956 18.3407 6.62998 18.8558C6.76435 19.3709 7.0938 19.8135 7.54868 20.09V20.09C8.00218 20.351 8.53992 20.4239 9.04654 20.293C9.55316 20.1622 9.98834 19.838 10.2587 19.39L10.2787 19.25C10.457 18.9561 10.708 18.7131 11.0075 18.5445C11.307 18.3759 11.6449 18.2872 11.9887 18.2872C12.3324 18.2872 12.6704 18.3759 12.9699 18.5445C13.2694 18.7131 13.5204 18.9561 13.6987 19.25L13.7687 19.39C14.0391 19.8407 14.4761 20.1668 14.9851 20.2978C15.4942 20.4288 16.0343 20.3542 16.4887 20.09C16.9367 19.8197 17.2609 19.3845 17.3917 18.8779C17.5226 18.3712 17.4497 17.8335 17.1887 17.38L17.1287 17.27C16.9541 16.9676 16.8617 16.6247 16.8607 16.2754C16.8597 15.9262 16.9502 15.5829 17.1231 15.2795C17.296 14.9761 17.5454 14.7232 17.8464 14.5461C18.1474 14.369 18.4895 14.2738 18.8387 14.27H18.9587C19.2525 14.2743 19.5438 14.2138 19.8116 14.0927C20.0794 13.9717 20.3172 13.793 20.5082 13.5696C20.6991 13.3462 20.8385 13.0835 20.9164 12.8001C20.9942 12.5167 21.0087 12.2196 20.9587 11.93C20.8669 11.451 20.6088 11.0198 20.2301 10.7124C19.8514 10.405 19.3763 10.2413 18.8887 10.25V10.25Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M12 14.79C13.3807 14.79 14.5 13.6707 14.5 12.29C14.5 10.9093 13.3807 9.78998 12 9.78998C10.6193 9.78998 9.5 10.9093 9.5 12.29C9.5 13.6707 10.6193 14.79 12 14.79Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
                    Default
                </button>
            </div>
            <div class="w-[75%] flex flex-col items-center justify-center gap-3">
                <div class="flex flex-row w-full gap-3 justify-between">
                    <!-- ZOOM -->
                    <div class="flex flex-col gap-2 w-1/2">
                        <div class="flex flex-row justify-between">
                            <span class="font-semibold">Zoom</span><span class="opacity-70">{zoom}</span>
                        </div>
                        <input type="range" min="0" max="4" class="range range-xs" step="0.05" bind:value={zoom} onpointerup={() => markFramesDirty()} />
                    </div>
                    <!-- BRIGHTNESS -->
                    <div class="flex flex-col gap-2 w-1/2">
                        <div class="flex flex-row justify-between">
                            <span class="font-semibold">Brightness</span><span class="opacity-70">{brightness}%</span>
                        </div>
                        <input type="range" min="10" max="300" class="range range-xs" step="10" bind:value={brightness} oninput={() => markFramesDirty()} />
                    </div>
                </div>

                <!-- IMAGE PROCESSING -->
                <div class="flex flex-row w-full gap-3 text-xs">
                    <!-- ROTATION -->
                    <div class="flex flex-col gap-2 w-1/2">
                        <div class="flex flex-row justify-between">
                            <span class="font-semibold">Rotation</span><span class="opacity-70">{rotation}°</span>
                        </div>
                        <input type="range" min="0" max="360" class="range range-xs" step="5" bind:value={rotation} oninput={() => markFramesDirty()} />
                    </div>

                    <!-- CONTRAST -->
                    <div class="flex flex-col gap-2 w-1/2">
                        <div class="flex flex-row justify-between">
                            <span class="font-semibold">Contrast</span><span class="opacity-70">{contrast}%</span>
                        </div>
                        <input type="range" min="10" max="300" class="range range-xs" step="10" bind:value={contrast} oninput={() => markFramesDirty()} />
                    </div>
                </div>

                <div class="flex flex-row w-full gap-3 text-xs">
                    <!-- REPLACE WHITE -->
                    <!-- <div class="flex flex-col gap-2 w-1/2">
                        <span class="font-semibold">Replace White</span>
                        <select class="select select-xs w-full truncate bg-primary text-primary-content border-0" bind:value={whiteBgReplacement} onchange={() => {processImage(canvasSize, pixelation)}}>
                            <option selected>Invisible</option>
                            {#each Object.entries(current_well_colors).filter(([name, val]) => name !== 'White' &&  name !== "Erase" && val) as [key, value], i}
                                <option>{key}</option>
                            {/each}
                        </select>
                    </div> -->

                    <!-- PIXELATION -->
                    <div class="flex flex-col gap-2 w-1/2">
                        <span class="flex flex-row justify-between">
                            <span class="font-semibold">Pixelation</span>
                            <span class="opacity-70">
                                {Math.round((pixelation - 4) / (canvasSize - 4) * 100)}%
                            </span>
                        </span>
                        <input
                            type="range"
                            min={canvasSize / 100}
                            max={canvasSize}
                            step={10}
                            bind:value={pixelation}
                            class="w-full range range-xs"
                            oninput={() => markFramesDirty()}
                        />
                    </div>

                    <!-- SATURATION -->
                    <div class="flex flex-col gap-2 w-1/2">
                        <div class="flex flex-row justify-between">
                            <span class="font-semibold">Saturation</span><span class="opacity-70">{saturation}%</span>
                        </div>
                        <input type="range" min="10" max="300" class="range range-xs" step="10" bind:value={saturation} oninput={() => markFramesDirty()} />
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <div class="flex flex-row w-full gap-3">
        <!-- GRID TYPE -->
        <div class="flex flex-col w-[50%] gap-2 mx-auto">
            <div class="flex flex-row justify-between">
                {#if Object.keys(point_colors).length > 0}
                    <span class="font-semibold">Move</span>
                {:else}
                    <span class="font-semibold">Mode</span>
                {/if}
            </div>
            <!-- Arrow keys for non-circular agar plates -->
            {#if Object.keys(point_colors).length > 0 && (grid_style === "Echo384" || grid_style === "Echo384Image" || grid_style === "Echo1536" || grid_style === "Echo1536Image")}
                <div class="flex flex-col mt-auto" in:fade={{ duration: 300 }}>
                    <div class="flex w-full justify-center">
                        <button class="kbd" onclick={() => {point_colors = shiftPoints("up", grid_spacing_mm, grid_spacing_mm, radius_mm, point_colors, grid_style); groupByColors();}}>▲</button>
                    </div>
                    <div class="flex w-full justify-center gap-2 pt-2">
                        <button class="kbd" onclick={() => {point_colors = shiftPoints("left", grid_spacing_mm, grid_spacing_mm, radius_mm, point_colors, grid_style); groupByColors();}}>◀︎</button>
                        <button class="kbd" onclick={() => {point_colors = shiftPoints("down", grid_spacing_mm, grid_spacing_mm, radius_mm, point_colors, grid_style); groupByColors();}}>▼</button>
                        <button class="kbd" onclick={() => {point_colors = shiftPoints("right", grid_spacing_mm, grid_spacing_mm, radius_mm, point_colors, grid_style); groupByColors();}}>▶︎</button>
                    </div>
                </div>
            {:else}
                {#if ginkgo_mode}
                    <div class="flex flex-col gap-2 flex-wrap justify-center {Object.keys(point_colors).length > 0 ? 'tooltip tooltip-top' : ''}" data-tip="Erase to edit" in:fade={{ duration: 300 }}>
                        <div class="w-full flex justify-between items-center">
                            <div class="join mx-auto">
                                <button class="btn btn-xs sm:btn-sm text-xs rounded-r-none hover:bg-neutral-700 {grid_style === 'Echo1536' ? 'bg-neutral-600' : 'bg-neutral-800'} {Object.keys(point_colors).length > 0 ? 'cursor-not-allowed' : ''}" type="button" onclick={() => {grid_style = "Echo1536"; point_size = 0.75; img = null; animationImages = 0;}} aria-label="Echo1536" disabled={Object.keys(point_colors).length > 0}>
                                    <svg class="w-4 h-4 sm:w-5 sm:h-5 opacity-75"  height="200px" width="200px" version="1.1" id="_x32_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" xml:space="preserve" fill="currentColor"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <style type="text/css"> .st0{fill:currentColor;} </style> <g> <path class="st0" d="M229.806,376.797l-58.165-40.976l-1.128-0.112c-26.889-2.741-53.247,9.248-68.79,31.31 c-14.743,20.928-20.101,43.743-25.282,65.812c-3.528,15.064-7.181,30.64-13.805,45.613c-5.483,12.382-9.156,16.802-9.169,16.822 l-3.784,4.283l5.148,2.479c23.958,11.542,56.31,13.143,88.766,4.394c34.09-9.182,62.639-28.109,80.372-53.28 c15.543-22.062,17.963-50.919,6.322-75.316L229.806,376.797z M208.721,442.4c-4.171,5.915-9.148,11.483-14.795,16.605 c-0.892,0.597-1.81,1.259-2.774,2.007c-10.657,8.382-24.548,4.775-16.101-12.224c8.447-17.012-6.44-22.456-18.534-11.286 c-15.175,14.022-22.298,2.826-19.491-4.913c2.8-7.738,12.881-18.291,4.446-25.111c-5.076-4.112-11.628,1.895-22.082,10.041 c-5.988,4.662-19.773,3.148-14.186-17.55c3.023-7.693,6.768-15.11,11.766-22.206c10.847-15.412,29.244-24.462,48.105-23.741 l49.81,35.087C221.923,406.631,219.575,426.988,208.721,442.4z"></path> <path class="st0" d="M191.519,277.032c-6.238,7.943-8.939,18.095-7.484,28.09c1.47,9.994,6.972,18.946,15.229,24.764l26.83,18.9 c8.257,5.817,18.547,7.988,28.45,6.007c9.903-1.993,18.554-7.962,23.938-16.5l24.357-38.734l-83.047-58.506L191.519,277.032z"></path> <path class="st0" d="M447.22,6.635l-0.204-0.138c-15.484-10.907-36.792-7.778-48.492,7.109L229.839,228.265l81.658,57.523 L456.847,54.687C466.934,38.658,462.697,17.541,447.22,6.635z"></path> </g> </g></svg>
                                    Draw
                                </button>
                                <button class="btn btn-xs sm:btn-sm text-xs rounded-l-none hover:bg-neutral-700 {grid_style === 'Echo1536Image' ? 'bg-neutral-600' : 'bg-neutral-800'} {Object.keys(point_colors).length > 0 ? 'cursor-not-allowed' : ''}" type="button" onclick={() => {grid_style = "Echo1536Image"; point_size = 0.75; canvasSize = 384; pixelation = 384;}} aria-label="Echo1536Image" disabled={Object.keys(point_colors).length > 0}>
                                    <svg class="w-4 h-4 sm:w-6 sm:h-6 opacity-75" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M4 10V6C4 4.89543 4.89543 4 6 4H12M4.02693 18.329C4.18385 19.277 5.0075 20 6 20H18C19.1046 20 20 19.1046 20 18V14.1901M4.02693 18.329C4.00922 18.222 4 18.1121 4 18V15M4.02693 18.329L7.84762 14.5083C8.52765 13.9133 9.52219 13.8481 10.274 14.3494L10.7832 14.6888C11.5078 15.1719 12.4619 15.1305 13.142 14.5864L15.7901 12.4679C16.4651 11.9279 17.4053 11.8855 18.1228 12.3484C18.2023 12.3997 18.2731 12.4632 18.34 12.5301L20 14.1901M20 14.1901V6C20 4.89543 19.1046 4 18 4H17M11 9C11 10.1046 10.1046 11 9 11C7.89543 11 7 10.1046 7 9C7 7.89543 7.89543 7 9 7C10.1046 7 11 7.89543 11 9Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
                                    Image
                                </button>
                            </div>
                        </div>
                    </div>
                {:else}
                    <div class="flex flex-col gap-2 flex-wrap justify-center {Object.keys(point_colors).length > 0 ? 'tooltip tooltip-top' : ''}" data-tip="Erase to edit" in:fade={{ duration: 300 }}>
                        <div class="w-full flex justify-between items-center">
                            <div class="join mx-auto">
                                <button class="btn btn-xs sm:btn-sm text-xs rounded-r-none hover:bg-neutral-700 {grid_style === 'Standard' ? 'bg-neutral-600' : 'bg-neutral-800'} {Object.keys(point_colors).length > 0 ? 'cursor-not-allowed' : ''}" type="button" onclick={() => {grid_style = "Standard"; point_size = 0.75; img = null; animationImages = 0;}} aria-label="Echo1536" disabled={Object.keys(point_colors).length > 0}>
                                    <svg class="w-4 h-4 sm:w-5 sm:h-5 opacity-75"  height="200px" width="200px" version="1.1" id="_x32_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" xml:space="preserve" fill="currentColor"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <style type="text/css"> .st0{fill:currentColor;} </style> <g> <path class="st0" d="M229.806,376.797l-58.165-40.976l-1.128-0.112c-26.889-2.741-53.247,9.248-68.79,31.31 c-14.743,20.928-20.101,43.743-25.282,65.812c-3.528,15.064-7.181,30.64-13.805,45.613c-5.483,12.382-9.156,16.802-9.169,16.822 l-3.784,4.283l5.148,2.479c23.958,11.542,56.31,13.143,88.766,4.394c34.09-9.182,62.639-28.109,80.372-53.28 c15.543-22.062,17.963-50.919,6.322-75.316L229.806,376.797z M208.721,442.4c-4.171,5.915-9.148,11.483-14.795,16.605 c-0.892,0.597-1.81,1.259-2.774,2.007c-10.657,8.382-24.548,4.775-16.101-12.224c8.447-17.012-6.44-22.456-18.534-11.286 c-15.175,14.022-22.298,2.826-19.491-4.913c2.8-7.738,12.881-18.291,4.446-25.111c-5.076-4.112-11.628,1.895-22.082,10.041 c-5.988,4.662-19.773,3.148-14.186-17.55c3.023-7.693,6.768-15.11,11.766-22.206c10.847-15.412,29.244-24.462,48.105-23.741 l49.81,35.087C221.923,406.631,219.575,426.988,208.721,442.4z"></path> <path class="st0" d="M191.519,277.032c-6.238,7.943-8.939,18.095-7.484,28.09c1.47,9.994,6.972,18.946,15.229,24.764l26.83,18.9 c8.257,5.817,18.547,7.988,28.45,6.007c9.903-1.993,18.554-7.962,23.938-16.5l24.357-38.734l-83.047-58.506L191.519,277.032z"></path> <path class="st0" d="M447.22,6.635l-0.204-0.138c-15.484-10.907-36.792-7.778-48.492,7.109L229.839,228.265l81.658,57.523 L456.847,54.687C466.934,38.658,462.697,17.541,447.22,6.635z"></path> </g> </g></svg>
                                    Draw
                                </button>
                                <button class="btn btn-xs sm:btn-sm text-xs rounded-l-none hover:bg-neutral-700 {grid_style === 'Standard' ? 'bg-neutral-600' : 'bg-neutral-800'} {Object.keys(point_colors).length > 0 ? 'cursor-not-allowed' : ''}" type="button" onclick={() => {resetValues(); grid_style = "Image"; point_size = 0.75; canvasSize = 40; pixelation = 40;}} aria-label="Image" disabled={Object.keys(point_colors).length > 0}>
                                    <svg class="w-4 h-4 sm:w-6 sm:h-6 opacity-75" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M4 10V6C4 4.89543 4.89543 4 6 4H12M4.02693 18.329C4.18385 19.277 5.0075 20 6 20H18C19.1046 20 20 19.1046 20 18V14.1901M4.02693 18.329C4.00922 18.222 4 18.1121 4 18V15M4.02693 18.329L7.84762 14.5083C8.52765 13.9133 9.52219 13.8481 10.274 14.3494L10.7832 14.6888C11.5078 15.1719 12.4619 15.1305 13.142 14.5864L15.7901 12.4679C16.4651 11.9279 17.4053 11.8855 18.1228 12.3484C18.2023 12.3997 18.2731 12.4632 18.34 12.5301L20 14.1901M20 14.1901V6C20 4.89543 19.1046 4 18 4H17M11 9C11 10.1046 10.1046 11 9 11C7.89543 11 7 10.1046 7 9C7 7.89543 7.89543 7 9 7C10.1046 7 11 7.89543 11 9Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
                                    Image
                                </button>
                            </div>
                        </div>
                    </div>
                {/if}
            {/if}
        </div>
        <!-- BACTERIA COLOR & CONTROLS -->
        <div class="flex flex-col w-[50%] gap-2 mx-auto">
            <div class="flex flex-row justify-between">
                <span class="font-semibold">Bacteria</span>
                {#if current_color !== 'Erase'}
                    <a class="opacity-70 underline" href={`https://www.fpbase.org/protein/${current_color.toLowerCase().split('_')[0]}`} target="_blank" rel="noopener noreferrer">{current_color}</a>
                {:else}
                    <span class="opacity-70">{current_color}</span>
                {/if}
            </div>
            <div class="grid grid-cols-6 gap-2 place-items-center my-auto">
                {#each Object.entries(current_well_colors).filter(([name, val]) => name !== 'White' && val) as [name]}
                    <div role="radio" tabindex="0" aria-checked={current_color === name} onclick={() => current_color = name} onkeydown={(e) => e.key === 'Enter' && (current_color = name)}
                        class="w-[24px] h-[24px] rounded-full cursor-pointer border-[1px] transition outline-none focus:ring-2 ring-offset-2 flex items-center justify-center"
                        style="background-color: #fffff; border-color: {well_colors[name]}; box-shadow: {current_color === name ? '0 0 0 0px #000 inset' : 'none'};"
                        title={name}
                    >
                        <div
                            class="w-[14px] h-[14px] rounded-full block"
                            style="background-color: {current_color === name ? well_colors[name] : '000'};"
                        ></div>
                    </div>
                {/each}
                {#if !ginkgo_mode}
                    <div role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter'} onclick={() => showBacteriaModal = !showBacteriaModal}
                        class="opacity-40 w-[24px] h-[24px] rounded-full cursor-pointer border-[1px] transition outline-none focus:ring-2 ring-offset-2 flex items-center justify-center"
                        style="background-color: #fffff; border-color: #fff; box-shadow: {'none'};">
                        <div class="w-[14px] h-[14px] rounded-full block text-primary">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M13 3C13 2.44772 12.5523 2 12 2C11.4477 2 11 2.44772 11 3V11H3C2.44772 11 2 11.4477 2 12C2 12.5523 2.44772 13 3 13H11V21C11 21.5523 11.4477 22 12 22C12.5523 22 13 21.5523 13 21V13H21C21.5523 13 22 12.5523 22 12C22 11.4477 21.5523 11 21 11H13V3Z" fill="currentColor"></path> </g></svg>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>

    {#if showBacteriaModal}
        <div class="relative overflow-y-none bg-secondary border rounded shadow z-10 p-2">
            <button class="absolute -top-2 -left-2 text-gray-500 hover:text-black text-sm bg-neutral rounded-full px-1 py-1" aria-label="close" onclick={() => showBacteriaModal = false}>
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M20.7457 3.32851C20.3552 2.93798 19.722 2.93798 19.3315 3.32851L12.0371 10.6229L4.74275 3.32851C4.35223 2.93798 3.71906 2.93798 3.32854 3.32851C2.93801 3.71903 2.93801 4.3522 3.32854 4.74272L10.6229 12.0371L3.32856 19.3314C2.93803 19.722 2.93803 20.3551 3.32856 20.7457C3.71908 21.1362 4.35225 21.1362 4.74277 20.7457L12.0371 13.4513L19.3315 20.7457C19.722 21.1362 20.3552 21.1362 20.7457 20.7457C21.1362 20.3551 21.1362 19.722 20.7457 19.3315L13.4513 12.0371L20.7457 4.74272C21.1362 4.3522 21.1362 3.71903 20.7457 3.32851Z" fill="#fff"></path> </g></svg>
            </button>
            <div class="flex justify-around items-center pb-4 pt-2 ">
                <div class="flex italic">Fluorescent Proteins</div>
                <div class="">
                    <div class="join">
                        <button class="btn join-item rounded-l btn-xs hover:bg-neutral hover:text-white" onclick={() => {current_well_colors = {...current_well_colors_import}; if (grid_style === 'Image') {processImage(canvasSize, pixelation);}}}>Default</button>
                        <button class="btn join-item btn-xs hover:bg-neutral hover:text-white" onclick={() => {Object.keys(well_colors).forEach(key => current_well_colors[key] = true); if (grid_style === 'Image') {processImage(canvasSize, pixelation);}}}>All On</button>
                        <button class="btn join-item rounded-r btn-xs hover:bg-neutral hover:text-white" onclick={() => {Object.keys(well_colors).forEach(key => {if (key !== 'White' && key !== 'Erase') { current_well_colors[key] = false;}}); if (grid_style === 'Image') {processImage(canvasSize, pixelation);}}}>All Off</button>
                    </div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                {#each Object.entries(well_colors).filter(([name, val]) => name !== 'White' && name !== 'Erase') as [key, value], i}
                    <label class="flex items-center justify-between px-2 py-1 border-b border-5 text-sm">
                        <span>{i+1}. {key}</span>
                        <input
                            type="checkbox"
                            bind:checked={current_well_colors[key]}
                            onchange={() => {current_well_colors = { ...current_well_colors }; if (grid_style === 'Image') {processImage(canvasSize, pixelation);}}}
                            class="checkbox checkbox-sm"
                        />
                    </label>
                {/each}
            </div>
        </div>
    {/if}

    <div class="flex flex-row w-full gap-6">
        {#if grid_style !== 'Echo1536' && grid_style !== 'Echo1536Image' && grid_style !== 'Echo384' && grid_style !== 'Echo384Image'}
            <!-- POINT SIZE -->
            <div class="flex flex-col w-full gap-2 mx-auto">
                <div class="flex flex-row justify-between">
                    <span class="font-semibold">Size</span><span class="opacity-70">{point_size}µL</span>
                </div>
                <input type="range" min="0.25" max="3" class="range" step="0.25" bind:value={point_size} />
            </div>
        {/if}
        <!-- GRID SPACING -->
        {#if grid_style === 'Echo1536' || grid_style === 'Echo1536Image' || grid_style === 'Echo384' || grid_style === 'Echo384Image'}
            <div class="flex flex-col w-full gap-2 mx-auto"></div>
        {:else}
            <div class="flex flex-col w-full gap-2 mx-auto">
                <div class="flex flex-row justify-between">
                    <span class="font-semibold">Spacing</span>
                    <span class="flex flex-row items-center gap-1">
                        {#if grid_spacing_mm < 2}
                            <button class="tooltip tooltip-top" aria-label="Small spacing alert" data-tip="Small spacing can cause points to merge">
                                <svg class="w-5 h-5t" viewBox="-0.5 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M18.2202 21.25H5.78015C5.14217 21.2775 4.50834 21.1347 3.94373 20.8364C3.37911 20.5381 2.90402 20.095 2.56714 19.5526C2.23026 19.0101 2.04372 18.3877 2.02667 17.7494C2.00963 17.111 2.1627 16.4797 2.47015 15.92L8.69013 5.10999C9.03495 4.54078 9.52077 4.07013 10.1006 3.74347C10.6804 3.41681 11.3346 3.24518 12.0001 3.24518C12.6656 3.24518 13.3199 3.41681 13.8997 3.74347C14.4795 4.07013 14.9654 4.54078 15.3102 5.10999L21.5302 15.92C21.8376 16.4797 21.9907 17.111 21.9736 17.7494C21.9566 18.3877 21.7701 19.0101 21.4332 19.5526C21.0963 20.095 20.6211 20.5381 20.0565 20.8364C19.4919 21.1347 18.8581 21.2775 18.2202 21.25V21.25Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M10.8809 17.15C10.8809 17.0021 10.9102 16.8556 10.9671 16.7191C11.024 16.5825 11.1074 16.4586 11.2125 16.3545C11.3175 16.2504 11.4422 16.1681 11.5792 16.1124C11.7163 16.0567 11.8629 16.0287 12.0109 16.03C12.2291 16.034 12.4413 16.1021 12.621 16.226C12.8006 16.3499 12.9398 16.5241 13.0211 16.7266C13.1023 16.9292 13.122 17.1512 13.0778 17.3649C13.0335 17.5786 12.9272 17.7745 12.7722 17.9282C12.6172 18.0818 12.4203 18.1863 12.2062 18.2287C11.9921 18.2711 11.7703 18.2494 11.5685 18.1663C11.3666 18.0833 11.1938 17.9426 11.0715 17.7618C10.9492 17.5811 10.8829 17.3683 10.8809 17.15ZM11.2409 14.42L11.1009 9.20001C11.0876 9.07453 11.1008 8.94766 11.1398 8.82764C11.1787 8.70761 11.2424 8.5971 11.3268 8.5033C11.4112 8.40949 11.5144 8.33449 11.6296 8.28314C11.7449 8.2318 11.8697 8.20526 11.9959 8.20526C12.1221 8.20526 12.2469 8.2318 12.3621 8.28314C12.4774 8.33449 12.5805 8.40949 12.6649 8.5033C12.7493 8.5971 12.8131 8.70761 12.852 8.82764C12.8909 8.94766 12.9042 9.07453 12.8909 9.20001L12.7609 14.42C12.7609 14.6215 12.6808 14.8149 12.5383 14.9574C12.3957 15.0999 12.2024 15.18 12.0009 15.18C11.7993 15.18 11.606 15.0999 11.4635 14.9574C11.321 14.8149 11.2409 14.6215 11.2409 14.42Z" fill="currentColor"></path> </g></svg>
                            </button>
                        {/if}
                        <span class="opacity-70">
                            {grid_spacing_mm}mm
                        </span>
                    </span>
                </div>
                <div class="{Object.keys(point_colors).length > 0 && !(grid_style === 'QRCode' || grid_style === 'Standard') ? 'tooltip tooltip-top' : ''}" data-tip="Erase Grid to Edit" >
                    <input type="range" min="1" max="7.5" disabled={blurSlider()} class="range {blurSlider() ? 'cursor-not-allowed blur-sm' : ''}" step="0.1" bind:value={grid_spacing_mm} />
                </div>
            </div>
        {/if}
    </div>

    <!-- SHOW POINTS -->
    <div class="flex flex-col w-full mt-3 gap-2 mx-auto bg-base-200 rounded px-3 {Object.keys(points_by_color).length >= 1 ? 'pb-2' : ''}">
        <div class="flex flex-row justify-between pt-2 items-center">
            <span class="font-semibold">Coordinates</span>
            <div class="flex flex-row flex-wrap justify-end gap-2 max-w-full overflow-hidden">
                {#if grid_style === 'Echo1536' || grid_style === 'Echo1536Image' || grid_style === 'Echo384' || grid_style === 'Echo384Image'}
                    <button class="btn btn-sm rounded gap-1 bg-base-100 text-base-content hover:bg-neutral hover:text-white opacity-70" onclick={download_echo_csv.showModal()}>
                        <svg class="w-5 h-5 inline-block align-middle" transform="scale(1.3) translate(-0.5 0)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"> <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 5v8.5m0 0l3-3m-3 3l-3-3M5 15v2a2 2 0 002 2h10a2 2 0 002-2v-2" /></svg>
                    </button>
                {:else}
                    <button class="btn btn-sm rounded gap-1 bg-base-100 text-base-content hover:bg-neutral hover:text-white" onclick={download_modal.showModal()}>
                        <svg class="w-5 h-5 inline-block align-middle" transform="scale(1.3) translate(-0.5 0)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"> <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 5v8.5m0 0l3-3m-3 3l-3-3M5 15v2a2 2 0 002 2h10a2 2 0 002-2v-2" /></svg>
                    </button>
                {/if}
                <button class="btn btn-sm rounded bg-base-100 gap-1 hover:bg-neutral hover:text-white px-1 tooltip tooltip-top" aria-label="Copy Points" data-tip="Copy To Clipboard" onclick={copyPointsToClipboard}>
                    <svg class="w-7 h-7 opacity-70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M10 8V7C10 6.05719 10 5.58579 10.2929 5.29289C10.5858 5 11.0572 5 12 5H17C17.9428 5 18.4142 5 18.7071 5.29289C19 5.58579 19 6.05719 19 7V12C19 12.9428 19 13.4142 18.7071 13.7071C18.4142 14 17.9428 14 17 14H16M7 19H12C12.9428 19 13.4142 19 13.7071 18.7071C14 18.4142 14 17.9428 14 17V12C14 11.0572 14 10.5858 13.7071 10.2929C13.4142 10 12.9428 10 12 10H7C6.05719 10 5.58579 10 5.29289 10.2929C5 10.5858 5 11.0572 5 12V17C5 17.9428 5 18.4142 5.29289 18.7071C5.58579 19 6.05719 19 7 19Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></g></svg>
                </button>
            </div>
        </div>
        {#if grid_style !== 'Echo384' && grid_style !== 'Echo384Image' && grid_style !== 'Echo1536' && grid_style !== 'Echo1536Image'}
            <div class="text-xs opacity-70" bind:this={contentToCopy}>
                {#if Object.keys(points_by_color).length >= 1}
                    {#each Object.entries(points_by_color) as [color, points]}
                        <div>
                            <span class="inline">{color}</span> =
                            [{#each points as {point}, i}
                                ({point[0]}, {point[1]}){#if i < points.length - 1},{/if}
                            {/each}]
                        </div>
                    {/each}
                {/if}
            </div>
        {:else if grid_style === 'Echo384' || grid_style === 'Echo384Image'}
            <div class="text-xs break-all whitespace-normal opacity-70" bind:this={contentToCopy}>
                {#if Object.keys(points_by_color).length >= 1}
                    {#each Object.entries(points_by_color) as [color, points]}
                        <div>
                            <span class="inline">{color}</span> =
                            [{#each points as {point}, i}
                                {String.fromCharCode(65 + point[1] / 5)}{point[0] / 5 + 1}{#if i < points.length - 1},{/if}
                            {/each}]
                        </div>
                    {/each}
                {/if}
            </div>
        {:else if grid_style === 'Echo1536' || grid_style === 'Echo1536Image'}
            <div class="text-xs break-all whitespace-pre overflow-hidden overflow-scroll opacity-70" bind:this={contentToCopy}>
                {#if Object.keys(points_by_color).length >= 1}
                    Source Plate Name, Source Plate Barcode, Source Plate Type, Source Well, Destination Plate Name, Destination Plate Barcode, Destination Plate Type, Destination Well, Transfer Volume
                    {#each Object.entries(points_by_color) as [color, points]}
                        <div>
                            {#each points as {point}, i}
                                Echo_Artwork_Source, {source_id}, 384-well Plate Echo PP, {source_384_well_colors[stripAfterLastUnderscore(color)]}1, Echo_Artwork_Dest, {destination_id}, 1-flat-thermo-264728-omni-1536, {rowLabel1536(point[1] / 2.5)}{point[0] / 2.5 + 1}, 100
                                <br />
                            {/each}
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}
    </div>

    <!-- ABOUT SECTION -->
    {#if !ginkgo_mode}
        <div class="collapse collapse-arrow pt-4">
            <input type="checkbox" id="section1" class="toggle-checkbox" />
            <label for="section1" class="collapse-title text-lg font-medium">What is Automation Art?</label>
            <div class="collapse-content text-sm">
                <p>This website is made for the Opentrons lab of <a class="italic underline" href="https://howtogrowalmostanything.notion.site/htgaa25" target="_blank" rel="noopener noreferrer">'How To Grow (Almost) Anything'</a> (HTGAA), to teach bio-enthusiasts of all backgrounds the principles and skills at the cutting edge of bioengineering and synthetic biology.</p>
            </div>
        </div>
        <div class="collapse collapse-arrow">
            <input type="checkbox" id="section2" class="toggle-checkbox" />
            <label for="section1" class="collapse-title text-lg font-medium">How To Use The Data Points</label>
            <div class="collapse-content">
                <p class="text-left text-sm">You should write a Python script that iterates over each coordinate and dispenses the correct color of bacteria into that location using the <a class="underline" href="https://docs.opentrons.com/v2/">Opentrons API</a>. Remember to switch pipette tips between each color and aspirate liquid as needed!
                <br />
                <br />
                <a class="underline" href="https://docs.google.com/document/d/1VR1ngrwncH4kW80PHKZDGITu4GJbDa7pCE9yCs4YdUU" target="_blank" rel="noopener noreferrer">HTGAA 2025 Opentrons Lab Protocol</a>
                <br />
                <br />
                <a class="underline" href="https://colab.research.google.com/drive/1VoouRH0nqlk09g50rHxOElaLD-SVknYY" target="_blank" rel="noopener noreferrer">HTGAA 2025 Opentrons Lab Colab</a>
            </div>
        </div>
        <div class="collapse collapse-arrow">
            <input type="checkbox" id="section3" class="toggle-checkbox" />
            <label for="section3" class="collapse-title text-lg font-medium">Tips & Tricks for Lab Day</label>
            <div class="collapse-content text-sm">
                <ul class="list-disc pl-5 space-y-2">
                    <li><span class="font-semibold">0.5-2µL points with 3-5mm spacing as a starting point</span>: You can experiment with different settings, but be aware that you may get unexpected results.</li>
                    <li><span class="font-semibold">Add an offset when necessary</span>: To adjust for varying amounts of agar, apply a vertical offset after loading `agar_plate` in your `run()` function using the `set_offset` method:<br />
                        <span class="italic pl-5">agar_plate.set_offset(x=0.00, y=0.00, z=11.0)</span>
                    </li>
                    <li><span class="font-semibold">Use a 100mm cell culture dish</span>: The <span class="italic">Thermo Fisher Nunclon Delta Surface Cell Culture Dish 100 (150464)</span> works best with the MIT Lab's 3D-printed holder.</li>
                    <li><span class="font-semibold">Take photographs</span>: Document your process thoroughly & keep notes as you go!</li>
                </ul>
            </div>
        </div>
        <div class="text-sm px-4 mt-5">
            <div class="max-w-[160px] mx-auto pt-4">
                <a href="https://github.com/RonanChance/opentrons-art-gui" target="_blank" rel="noopener noreferrer" data-value="github" style="border-radius:2px;" class="py-2 px-1 flex justify-center items-center bg-gray-100 hover:bg-neutral hover:text-white text-neutral transition ease-in duration-100 text-center text-sm font-semibold shadow-md focus:outline-none">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" class="mr-2" viewBox="0 0 1792 1792">
                    <path d="M896 128q209 0 385.5 103t279.5 279.5 103 385.5q0 251-146.5 451.5t-378.5 277.5q-27 5-40-7t-13-30q0-3 .5-76.5t.5-134.5q0-97-52-142 57-6 102.5-18t94-39 81-66.5 53-105 20.5-150.5q0-119-79-206 37-91-8-204-28-9-81 11t-92 44l-38 24q-93-26-192-26t-192 26q-16-11-42.5-27t-83.5-38.5-85-13.5q-45 113-8 204-79 87-79 206 0 85 20.5 150t52.5 105 80.5 67 94 39 102.5 18q-39 36-49 103-21 10-45 15t-57 5-65.5-21.5-55.5-62.5q-19-32-48.5-52t-49.5-24l-20-3q-21 0-29 4.5t-5 11.5 9 14 13 12l7 5q22 10 43.5 38t31.5 51l10 23q13 38 44 61.5t67 30 69.5 7 55.5-3.5l23-4q0 38 .5 88.5t.5 54.5q0 18-13 30t-40 7q-232-77-378.5-277.5t-146.5-451.5q0-209 103-385.5t279.5-279.5 385.5-103zm-477 1103q3-7-7-12-10-3-13 2-3 7 7 12 9 6 13-2zm31 34q7-5-2-16-10-9-16-3-7 5 2 16 10 10 16 3zm30 45q9-7 0-19-8-13-17-6-9 5 0 18t17 7zm42 42q8-8-4-19-12-12-20-3-9 8 4 19 12 12 20 3zm57 25q3-11-13-16-15-4-19 7t13 15q15 6 19-6zm63 5q0-13-17-11-16 0-16 11 0 13 17 11 16 0 16-11zm58-10q-2-11-18-9-16 3-14 15t18 8 14-14z"></path>
                    </svg>
                    View on GitHub
                </a>
            </div>
        </div>
    {:else}
        <div class="collapse collapse-arrow pt-2">
            <input type="checkbox" id="section1" class="toggle-checkbox" />
            <label for="section1" class="collapse-title text-lg font-medium">What is Automation Art Interface?</label>
            <div class="collapse-content text-sm">
                <p>It's a fluorescent bacteria artwork interface which remotely programs the <a class="font-bold underline" href="https://www.ginkgo.bio/product/hardware" target="_blank" rel="noopener noreferrer">Reconfigurable Automation Cart</a> (RAC) system at <a class="font-bold underline" href="https://www.ginkgo.bio" target="_blank" rel="noopener noreferrer">Ginkgo Bioworks</a>.
                <br />
                <br />
                Nanoliter droplets of fluorescent bacterial culture are dispensed onto an agar plate and photographed after incubation.
                <br />
                <br />
                <img src="/bacteria_images/echo_test.jpeg" class="mx-auto w-[75%] outline outline-neutral outline-1 rounded" alt="Pixelated" />
                <div class="text-xs italic text-center mt-2">Fluorescent Bacteria Photograph</div>
            </div>
        </div>
        <div class="collapse collapse-arrow">
            <input type="checkbox" id="section2" class="toggle-checkbox" />
            <label for="section1" class="collapse-title text-lg font-medium">How Does It Work?</label>
            <div class="collapse-content">
                <p class="text-left text-sm">1. Publish your designed agar plate to the website gallery.
                <br />
                <br />
                <p class="text-left text-sm">2. Approved designs are queued for automated production.
                <br />
                <br />
                <div class="grid grid-cols-2 gap-2">
                    <div class="flex flex-col">
                        <video autoplay loop muted playsinline class="rounded">
                            <source src="/clips/output_1.mp4" type="video/mp4">
                        </video>
                        <span class="text-xs italic text-center mt-1">Retrieval from Storage</span>
                    </div>

                    <div class="flex flex-col">
                        <video autoplay loop muted playsinline class="rounded">
                            <source src="/clips/output_2.mp4" type="video/mp4">
                        </video>
                        <span class="text-xs italic text-center mt-1">Travel on Magnemotion</span>
                    </div>

                    <div class="flex flex-col">
                        <video autoplay loop muted playsinline class="rounded">
                            <source src="/clips/output_3.mp4" type="video/mp4">
                        </video>
                        <span class="text-xs italic text-center mt-1">Culture Plate into Echo 525</span>
                    </div>

                    <div class="flex flex-col">
                        <video autoplay loop muted playsinline class="rounded">
                            <source src="/clips/output_4.mp4" type="video/mp4">
                        </video>
                        <span class="text-xs italic text-center mt-1">Agar Plate into Echo 525</span>
                    </div>
                </div>
                <br />
                <p class="text-left text-sm">3. After incubating overnight, the artwork is photographed under UV light and posted to the gallery tab.
            </div>
        </div>
        <div class="text-sm px-4">
            <div class="max-w-[160px] mx-auto pt-4">
                <a href="https://www.ginkgo.bio" target="_blank" rel="noopener noreferrer" data-value="github" style="border-radius:2px;" class="py-2 px-1 flex justify-center items-center bg-neutral hover:bg-neutral-600 hover:text-white text-white transition ease-in duration-100 text-center text-sm font-semibold shadow-md focus:outline-none">
                    <svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1514 1527" width="20" height="20" fill="currentColor" >
                        <path id="Layer" class="" d="m1151.8 146.1l-11.2 11.2c-22.4 18.7-52.2 26.1-78.3 14.9l-82-33.6c-26.1-11.2-44.7-37.3-44.7-67.1v-18.7c0-29.8-26.1-52.2-52.2-52.2h-227.4c-29.8 0-52.2 22.4-52.2 52.2v18.7c0 29.8-18.6 55.9-44.7 67.1l-82 33.6c-26.1 11.2-59.6 3.8-78.3-14.9l-11.1-11.2c-22.4-18.7-52.2-18.7-74.6 0l-167.7 160.5c-18.7 18.6-22.4 52.2 0 74.6l11.2 11.2c18.6 22.4 26 52.2 14.9 78.4l-33.6 82.1c-11.2 26.1-37.3 44.7-67.1 44.7h-18.6c-29.8 0-52.2 26.2-52.2 52.3v227.6c0 29.9 22.4 52.3 52.2 52.3h18.6c29.8 0 55.9 18.6 67.1 44.7l33.6 82.1c11.1 26.2 3.7 59.8-14.9 78.4l-11.2 11.2c-18.7 22.4-18.7 52.2 0 74.6l160.3 160.5c18.6 18.7 52.1 22.4 74.5 0l11.2-11.2c22.3-18.7 52.2-26.1 78.3-14.9l82 33.6c26.1 11.2 44.7 37.3 44.7 67.1v18.7c0 29.8 26.1 52.2 52.2 52.2h227.4c29.8 0 52.1-22.4 52.1-52.2v-18.7c0-29.8 18.7-55.9 44.8-67.1l82-33.6c26.1-11.2 59.6-3.8 78.2 14.9l11.2 11.2c22.4 18.7 52.2 18.7 74.6 0l52.2-52.2-290.8-291.1c-37.3-37.3-123-123.2-234.8-11.2-33.6 33.6-55.9 78.4-89.5 111.9-78.2 78.4-171.4 41.1-208.7-33.5-22.4-44.8-14.9-48.6-37.3-89.6-26.1-41.1-70.8-70.9-85.7-123.2-11.2-52.2 14.9-67.1 14.9-93.2 0-26.2-26.1-56-18.6-93.3 3.7-29.9 26.1-48.5 29.8-63.5 3.7-14.9 3.7-26.1 7.4-48.5 14.9-67.2 78.3-100.7 134.2-63.4 37.3 26.1 119.3 115.7 130.5 104.5 11.2-11.2-78.3-93.3-104.4-130.6-37.3-56-3.7-123.2 63.4-134.4 22.3-3.7 37.3-3.7 48.4-7.5 15-7.4 29.9-26.1 63.4-29.8 37.3-7.5 70.8 18.7 93.2 18.7 26.1 0 44.7-26.2 93.2-15 52.2 11.2 82 59.7 123 85.9 41 26.1 41 18.6 89.4 37.3 74.6 37.3 115.6 130.6 33.6 208.9-33.6 33.6-78.3 52.3-111.8 89.6-111.9 112-22.4 197.8 11.2 235.1l290.7 291.1 52.2-52.3c18.6-18.6 22.3-52.2 0-74.6l-11.2-11.2c-18.6-22.4-26.1-52.2-14.9-78.4l33.5-82.1c11.2-26.1 37.3-44.7 67.1-44.7h18.7c29.8 0 52.1-26.2 52.1-52.3v-227.6c0-29.9-22.3-52.3-52.1-52.3h-18.7c-29.8 0-55.9-18.6-67.1-44.7l-33.5-82.1c-11.2-26.2-3.7-59.7 14.9-78.4l11.2-11.2c18.6-22.4 18.6-52.2 0-74.6l-160.3-160.5c-3.7-29.9-37.3-29.9-55.9-11.2z"/>
                    </svg>
                    <div class="pl-1.5">Ginkgo Bioworks</div>
                </a>
            </div>
        </div>
    {/if}

</div>

<style>
    input.no-spinner::-webkit-outer-spin-button,
    input.no-spinner::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    /* Firefox */
    input.no-spinner[type=number] {
        -moz-appearance: textfield;
    }

    .gif-scrubber { --range-shdw: 0 0 #0000; }

    .gif-scrubber::-webkit-slider-thumb {
        background-color: #404040; /* Tailwind gray-400 */
    }

    /* Firefox */
    .gif-scrubber::-moz-range-thumb {
        background-color: #404040;
    }
</style>