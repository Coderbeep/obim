/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        normal: '#222222',
        muted: '#5C5C5C',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')]
}
