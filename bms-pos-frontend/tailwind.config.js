/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'higea-blue': '#0056B3', // Azul Institucional
        'higea-red': '#E11D2B',  // Rojo Institucional
        'higea-bg': '#F1F5F9',   
      },
      fontFamily: {
        sans: ['Poppins', 'sans-serif'], // <--- AQUÍ ESTÁ EL CAMBIO CLAVE
      }
    },
  },
  plugins: [],
}