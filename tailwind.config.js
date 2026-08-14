/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],

  theme: {
    extend: {}
  },

  plugins: [
    require('@tailwindcss/typography'),
    require('daisyui'),
  ],

  daisyui: {
    themes: [
      "light",
      {
        black: {
          "base-100": "#141414",
          "base-content": "#f7f5f0",
          
          primary: "#f7f5f0",
          "primary-content": "#222222",
          
          secondary: "#222222",
          "secondary-content": "#f7f5f0",
          
          neutral: "#333333",
          "neutral-content": "#f7f5f0",

          accent: "#ff3b82",
          "accent-content": "#f7f5f0"
        }
      }
    ]
  }
};
