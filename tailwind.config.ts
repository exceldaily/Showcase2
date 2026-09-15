import type { Config } from "tailwindcss";

// Palette: deep navy surfaces with three levels of depth, one cool
// accent (brand) for actions, violet for "mine" (my trade), and the
// three meaning colors (bull / bear / warn) reserved for meaning only.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#070b13",
          panel: "#0b1119",
          card: "#0f1722",
          elevated: "#151f2e",
          hover: "#1b2739",
        },
        border: {
          DEFAULT: "#1c2637",
          light: "#2a3850",
          glow: "#2f4b7a",
        },
        brand: {
          DEFAULT: "#4f8cff",
          glow: "#8ab4ff",
          deep: "#2f63d6",
        },
        mine: "#c084fc",
        bull: "#1fd18a",
        bear: "#f04452",
        warn: "#f5b301",
        ink: {
          DEFAULT: "#e9eef6",
          muted: "#98a5b8",
          faint: "#64718a",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(79,140,255,0.25), 0 8px 30px -10px rgba(79,140,255,0.35)",
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
      },
    },
  },
  plugins: [],
};

export default config;
