import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';

const pb = new PocketBase("https://opentrons-art-pb.rcdonovan.com");

export const POST = async ({ request }) => {
    let { title, author, points, grid_style, radius_mm, grid_spacing_mm, point_colors, point_size, canvasSize: canvas_size, pixelationLevel : pixelation_level, brightness, contrast, saturation, ginkgo_mode, lastLoadedGifUrl, zoom, rotation, pixelation } = await request.json();
    try {
        let num_drops = Object.keys(point_colors).length;
        let num_total = points.length;
        let unique_colors = [...new Set(Object.values(point_colors))];
        let gif_url = lastLoadedGifUrl || null;
        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

        // confirm we aren't adding the same art repeatedly, use _.isEqual because the objects are unordered
        let recentEntry;
        if (ginkgo_mode) {
            recentEntry = await pb.collection("sbs_designs").getList(1, 1, { sort: "-created" });
        } else {
            recentEntry = await pb.collection("designs").getList(1, 1, { sort: "-created" });
        }
        if ( JSON.stringify(Object.entries(point_colors).sort()) === JSON.stringify(Object.entries(recentEntry.items[0].point_colors).sort())) {
            return new Response(JSON.stringify({ success: true, duplicate: true }));
        }
        let newEntry;
        if (ginkgo_mode) {
            newEntry = await pb.collection("sbs_designs").create({
                title,
                author,
                grid_style,
                num_drops,
                num_total,
                unique_colors,
                radius_mm,
                grid_spacing_mm,
                point_size,
                point_colors,
                canvas_size,
                pixelation_level,
                brightness,
                contrast,
                saturation,
                gif_url,
                zoom,
                rotation,
                pixelation
            });
        } else {
            newEntry = await pb.collection("designs").create({
                title,
                author,
                grid_style,
                num_drops,
                num_total,
                unique_colors,
                radius_mm,
                grid_spacing_mm,
                point_size,
                point_colors,
                canvas_size,
                pixelation_level,
                brightness,
                contrast,
                saturation
            });
        }
        return new Response(JSON.stringify({success: true, id: newEntry.id, duplicate: false}));
    } catch (e) {
        console.log(e)
        return new Response(JSON.stringify({success: false, duplicate: false}))
    }
};