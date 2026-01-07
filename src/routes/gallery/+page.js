import PocketBase from 'pocketbase';

export async function load() {
    const pb = new PocketBase("https://opentrons-art-pb.rcdonovan.com");

    // fetch the record
    const record = await pb.collection('plate_pictures').getOne('gg40q5l7uqe1r04');

    // split the filenames by newline and filter out empty lines
    const url_prefix = 'https://ginkgo-artworks.nyc3.cdn.digitaloceanspaces.com/agar-art/';
    const images = record.filename_list
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(filename => url_prefix + filename);
        
    console.log(images);
    return { images };
}
