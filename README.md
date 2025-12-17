# Ginkgo Artworks
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![Svelte](https://img.shields.io/badge/Svelte-5.0.0-orange) ![SvelteKit](https://img.shields.io/badge/SvelteKit-2.16.0-red) ![DigitalOcean](https://img.shields.io/badge/DigitalOcean-Active-blue) ![PocketBase](https://img.shields.io/badge/PocketBase-v1.14.1-green)

A graphical interface for making fluorescent bacteria patterns with lab automation equipment. Optimized for the Echo 525 acoustic liquid handler on [Ginkgo Nebula](https://www.ginkgo.bio).

Built for [How To Grow Almost Anything](https://howtogrowalmostanything.notion.site/htgaa25) (HTGAA) at the [MIT Media Lab](https://www.media.mit.edu). 

## Features 
- User interface for 100mm agar plate coordinates or 1536-well OmniTrays.
- Share designs to a open-source gallery.
- UV light photography image gallery.

## Want to Make Fluorescent Artwork at Your Lab?
CSV files are downloadable for all designs and support upload to:
- Echo 525 
- Opentrons OT-2

## Automation Videos
<div style="display: flex; gap: 10px;">
  <a href="https://github.com/user-attachments/assets/4168a4a5-14e4-49a7-a5ec-d5b0fb4fd3d3">
    <img src="https://github.com/user-attachments/assets/4168a4a5-14e4-49a7-a5ec-d5b0fb4fd3d3" width="150">
  </a>
  <a href="https://github.com/user-attachments/assets/8da71b3c-c460-4333-b0d5-8505eb7604a5">
    <img src="https://github.com/user-attachments/assets/8da71b3c-c460-4333-b0d5-8505eb7604a5" width="150">
  </a>
  <a href="https://github.com/user-attachments/assets/4bb5604c-7fe9-46a9-9688-6a5c89801a2c">
    <img src="https://github.com/user-attachments/assets/4bb5604c-7fe9-46a9-9688-6a5c89801a2c" width="150">
  </a>
</div>

## Website Development

Feature additions are welcome.

Clone this repository, navigate to the opentrons-art-gui directory and install dependencies with `npm install`. 

Then start a development server:

```bash
npm run dev
```

### Tech Stack

- **Frontend**: [SvelteKit](https://kit.svelte.dev/), [JavaScript](https://en.wikipedia.org/wiki/JavaScript)
- **Backend**: [Node.js](https://nodejs.org/)
- **Database**: [PocketBase (SQLite)](https://pocketbase.io)
- **Hosting**: [DigitalOcean Droplet, Spaces](https://digitalocean.com)
