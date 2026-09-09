/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        quasar: {
          bg: "#0a0a0f",
          surface: "#12121a",
          border: "#232336",
          accent: "#8b5cf6",
          "accent-hover": "#7c3aed",
          "accent-soft": "#1c1333",
        },
      },
      boxShadow: {
        glow: "0 0 28px rgba(139, 92, 246, 0.35)",
        "glow-sm": "0 0 14px rgba(139, 92, 246, 0.25)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
