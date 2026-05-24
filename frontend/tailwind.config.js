/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        // 預設採系統字型 + 思源黑體 / 蘋方備援，避免額外網路字型成本
        sans: [
          'system-ui',
          '-apple-system',
          'PingFang TC',
          'Noto Sans TC',
          'Noto Sans CJK TC',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
