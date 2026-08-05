/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html','./privacy.html','./js/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { prompt: ['Prompt', 'sans-serif'] },
      colors: {
        brand: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
        },
      },
    },
  },
  plugins: [],
  safelist: [
    { pattern: /^(bg|text|border)-(emerald|rose|orange|amber|blue|purple|gray|brand)-(50|100|200|300|400|500|600|700|800|900)$/ },
    { pattern: /^(bg|text|border)-(emerald|rose|orange|amber|blue|purple|gray|brand)-(50|100|200|300|400|500|600|700|800|900)\/(20|30|40|50)$/ },
    { pattern: /^dark:(bg|text|border)-(emerald|rose|orange|amber|blue|purple|gray|brand)-(50|100|200|300|400|500|600|700|800|900)$/ },
    { pattern: /^dark:(bg|text|border)-(emerald|rose|orange|amber|blue|purple|gray|brand)-(50|100|200|300|400|500|600|700|800|900)\/(20|30|40|50)$/ },
    'rotate-180','hidden','ring-2','ring-brand-500',
  ],
};
