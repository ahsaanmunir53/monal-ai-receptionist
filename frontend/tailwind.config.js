/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b1512', card: '#122820', card2: '#16332a',
        gold: '#d4a94b', gold2: '#e8c87a', em: '#1f6f54', em2: '#2a9d75',
        ink: '#eef5f1', mut: '#9db8ac',
      },
      fontFamily: { serif: ['"Playfair Display"', 'Georgia', 'serif'], sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
