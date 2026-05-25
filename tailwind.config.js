/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'Noto Sans Devanagari', 'Noto Sans Tamil', 'Noto Sans Telugu', 'system-ui', 'sans-serif'] },
      colors: {
        brand: {
          50: '#eef4ff', 100: '#dbe6ff', 200: '#bfd1ff', 300: '#93b1ff',
          400: '#6486ff', 500: '#3f60f7', 600: '#2b43ec', 700: '#2434d0',
          800: '#212ea8', 900: '#202c85',
        }
      },
      boxShadow: {
        'soft': '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)',
        'card': '0 4px 12px rgba(16,24,40,.06), 0 2px 4px rgba(16,24,40,.04)',
      }
    }
  },
  plugins: [],
}
