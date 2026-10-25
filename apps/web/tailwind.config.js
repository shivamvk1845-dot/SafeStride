/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { ink: "#101b2b", panel: "#172538", teal: "#20c7ae", mist: "#a2afbd" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui"] },
    },
  },
  plugins: [],
};
