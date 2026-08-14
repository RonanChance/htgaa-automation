<article class="prose w-full mx-auto mt-5">
    <h2 class="text-center text-neutral">HTGAA Web Apps</h2>
</article>

<div class="w-full flex mx-auto justify-center gap-3 flex-col sm:flex-row">
    <!-- Gel Art -->
    <div class="card bg-base-100 w-64 shadow-sm mx-auto sm:mx-0">
        <figure class="px-7 pt-10 bg-white flex items-center justify-center">
            <img
            src={`/nav_images/mit_gel.png`}
            alt="Media Lab Logo"
            class="rounded-xl object-contain h-40 w-full"
            />
        </figure>
        <div class="card-body items-center text-center">
            <h2 class="card-title">DNA Gel Artwork</h2>
            <p class="text-xs">DNA gel electrophoresis artwork with restriction enzymes</p>

            <div class="card-actions justify-center pt-3">
            <a href="/gel-art"
                class="btn btn-sm rounded bg-gray-100 gap-2 hover:bg-neutral hover:text-white flex items-center"
            >
            <svg class="w-4 h-4 opacity-75" fill="currentColor" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 539.123 539.124" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <g> <path d="M516.65,0.006H22.467c-6.089,0-11.353,2.222-15.796,6.665C2.222,11.126,0,16.39,0,22.467v494.19 c0,6.071,2.222,11.341,6.671,15.796c4.443,4.443,9.707,6.664,15.796,6.664h494.189c6.084,0,11.348-2.221,15.797-6.664 c4.441-4.455,6.67-9.719,6.67-15.796V22.467c0-6.071-2.229-11.34-6.67-15.795C527.996,2.228,522.734,0.006,516.65,0.006z M247.095,426.796c0,3.274-1.053,5.968-3.158,8.079c-2.105,2.111-4.798,3.151-8.072,3.151H67.394c-3.28,0-5.967-1.04-8.072-3.151 s-3.158-4.798-3.158-8.079V67.394c0-3.274,1.052-5.967,3.158-8.078s4.792-3.152,8.072-3.152h168.471 c3.274,0,5.967,1.041,8.072,3.152c2.105,2.111,3.158,4.798,3.158,8.078V426.796z M482.953,292.029c0,3.273-1.053,5.96-3.158,8.078 c-2.104,2.099-4.797,3.151-8.072,3.151H303.252c-3.279,0-5.967-1.059-8.072-3.151c-2.105-2.111-3.158-4.798-3.158-8.078V67.394 c0-3.274,1.053-5.967,3.158-8.078s4.793-3.152,8.072-3.152h168.471c3.275,0,5.969,1.041,8.072,3.152 c2.105,2.111,3.158,4.798,3.158,8.078V292.029z"></path> </g> </g> </g></svg>
                Launch Editor
            </a>
            </div>
        </div>
    </div>
    <!-- Protein Explorer -->
    <div class="card bg-base-100 w-64 shadow-sm mx-auto sm:mx-0">
        <figure class="px-7 pt-10 bg-white flex items-center justify-center">
            <svg
                class="rounded-xl h-40 w-full"
                viewBox="0 0 160 160"
                xmlns="http://www.w3.org/2000/svg"
                aria-label="Protein ribbon"
            >
                <defs>
                    <linearGradient id="ribbonGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#2563eb" />
                        <stop offset="50%" stop-color="#0891b2" />
                        <stop offset="100%" stop-color="#dc2626" />
                    </linearGradient>
                </defs>
                <path
                    d="M20 80 Q40 20, 60 80 T100 80 T140 80"
                    fill="none"
                    stroke="url(#ribbonGrad)"
                    stroke-width="10"
                    stroke-linecap="round"
                />
                <path
                    d="M20 100 Q40 40, 60 100 T100 100 T140 100"
                    fill="none"
                    stroke="url(#ribbonGrad)"
                    stroke-width="4"
                    stroke-linecap="round"
                    opacity="0.5"
                />
            </svg>
        </figure>
        <div class="card-body items-center text-center">
            <h2 class="card-title">Protein Explorer</h2>
            <p class="text-xs">Rotate real folds, mutate residues, estimate E. coli producibility</p>

            <div class="card-actions justify-center pt-3">
                <a href="/protein"
                    class="btn btn-sm rounded bg-gray-100 gap-2 hover:bg-neutral hover:text-white flex items-center"
                >
                    <svg class="w-4 h-4 opacity-75" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>
                    </svg>
                    Launch Explorer
                </a>
            </div>
        </div>
    </div>

    <!-- Starfield -->
    <div class="card bg-base-100 w-64 shadow-sm mx-auto sm:mx-0">
        <figure class="px-7 pt-10 bg-black flex items-center justify-center">
            <svg
                class="rounded-xl h-40 w-full"
                viewBox="0 0 160 160"
                xmlns="http://www.w3.org/2000/svg"
                aria-label="Constellation of proteins"
            >
                <!-- Constellation lines -->
                <g stroke="#334155" stroke-width="0.6" fill="none" opacity="0.9">
                    <path d="M40 60 L70 80 L100 55 L130 90 M70 80 L60 115 M100 55 L110 30 M100 55 L130 55" />
                </g>
                <!-- Stars (mixed sizes, mixed emission colors) -->
                <circle cx="40" cy="60" r="2.4" fill="#22d3ee">
                    <animate attributeName="opacity" values="0.7;1;0.7" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle cx="70" cy="80" r="3.2" fill="#4ade80">
                    <animate attributeName="opacity" values="0.8;1;0.8" dur="4s" repeatCount="indefinite" />
                </circle>
                <circle cx="100" cy="55" r="3" fill="#facc15">
                    <animate attributeName="opacity" values="0.7;1;0.7" dur="3.5s" repeatCount="indefinite" />
                </circle>
                <circle cx="130" cy="90" r="2.6" fill="#f97316">
                    <animate attributeName="opacity" values="0.8;1;0.8" dur="2.8s" repeatCount="indefinite" />
                </circle>
                <circle cx="60" cy="115" r="2.2" fill="#ef4444">
                    <animate attributeName="opacity" values="0.7;1;0.7" dur="3.2s" repeatCount="indefinite" />
                </circle>
                <circle cx="110" cy="30" r="1.8" fill="#a855f7" />
                <circle cx="130" cy="55" r="1.6" fill="#ec4899" />
                <!-- Scattered small stars -->
                <circle cx="22" cy="30" r="0.8" fill="white" opacity="0.5" />
                <circle cx="30" cy="105" r="0.7" fill="white" opacity="0.4" />
                <circle cx="90" cy="110" r="0.9" fill="white" opacity="0.5" />
                <circle cx="145" cy="125" r="0.8" fill="white" opacity="0.4" />
                <circle cx="12" cy="80" r="0.6" fill="white" opacity="0.5" />
                <circle cx="82" cy="20" r="0.8" fill="white" opacity="0.5" />
                <circle cx="150" cy="35" r="0.7" fill="white" opacity="0.4" />
                <circle cx="140" cy="140" r="1" fill="white" opacity="0.6" />
            </svg>
        </figure>
        <div class="card-body items-center text-center">
            <h2 class="card-title">Starfield</h2>
            <p class="text-xs">A universe of fluorescent proteins — orbit lineages, click to explore</p>

            <div class="card-actions justify-center pt-3">
                <a href="/starfield"
                    class="btn btn-sm rounded bg-gray-100 gap-2 hover:bg-neutral hover:text-white flex items-center"
                >
                    <svg class="w-4 h-4 opacity-75" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 2 L14 8 L20 9 L15 13 L17 20 L12 16 L7 20 L9 13 L4 9 L10 8 Z" />
                    </svg>
                    Enter Starfield
                </a>
            </div>
        </div>
    </div>

    <!-- Automation Art -->
    <div class="card bg-base-100 w-64 shadow-sm mx-auto sm:mx-0">
        <figure class="px-10 pt-10 bg-white flex items-center justify-center">
            <img
            src={`/nav_images/mit_grid.png`}
            alt="Media Lab Logo"
            class="rounded-xl object-contain h-40 w-full"
            />
        </figure>

        <div class="card-body items-center text-center">
            <h2 class="card-title">Automation Artwork</h2>
            <p class="text-xs">Fluorescent protein artwork with an Opentrons or Echo 525</p>

            <div class="card-actions justify-center pt-3">
            <a href="/"
                class="btn btn-sm rounded bg-gray-100 gap-2 hover:bg-neutral hover:text-white flex items-center"
            >
                <svg
                class="w-5 h-5 opacity-75"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                >
                <circle cx="12" cy="12" r="10" />
                <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
                <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
                <circle cx="16" cy="8" r="1" fill="currentColor" stroke="none" />
                <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
                <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" />
                <circle cx="8" cy="16" r="1" fill="currentColor" stroke="none" />
                <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
                <circle cx="16" cy="16" r="1" fill="currentColor" stroke="none" />
                </svg>
                Launch Editor
            </a>
            </div>
        </div>
    </div>
</div>
