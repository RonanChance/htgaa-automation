import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';

const pb = new PocketBase("https://opentrons-art-pb.rcdonovan.com");

export const POST = async ({ request }) => {
    let { title, author, points, grid_style, radius_mm, grid_spacing_mm, point_colors, point_size, canvasSize: canvas_size, pixelationLevel : pixelation_level, brightness, contrast, saturation, ginkgo_mode, target_collection, lastLoadedGifUrl, zoom, rotation, pixelation } = await request.json();
    try {
        let num_drops = Object.keys(point_colors).length;
        let num_total = points.length;
        let unique_colors = [...new Set(Object.values(point_colors))];
        let gif_url = lastLoadedGifUrl || null;
        const collectionName = target_collection || (ginkgo_mode ? "sbs_designs" : "designs");
        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

        // confirm we aren't adding the same art repeatedly, use _.isEqual because the objects are unordered
        const recentEntry = await pb.collection(collectionName).getList(1, 1, { sort: "-created" });
        if (
            recentEntry.items.length > 0 &&
            JSON.stringify(Object.entries(point_colors).sort()) === JSON.stringify(Object.entries(recentEntry.items[0].point_colors).sort())
        ) {
            return new Response(JSON.stringify({ success: true, duplicate: true, id: recentEntry.items[0].id }));
        }
        const payload = {
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
        };
        if (collectionName !== "designs") {
            payload.gif_url = gif_url;
            payload.zoom = zoom;
            payload.rotation = rotation;
            payload.pixelation = pixelation;
        }
        const newEntry = await pb.collection(collectionName).create(payload);
        return new Response(JSON.stringify({success: true, id: newEntry.id, duplicate: false}));
    } catch (e) {
        console.log(e)
        return new Response(JSON.stringify({success: false, duplicate: false}))
    }
};
