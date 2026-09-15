import type { Config } from "tailwindcss";

// Design tokens. Four surface levels separated by elevation, not
// borders; one accent (brand) for selection and actions; violet for
// "mine" (the trader's own position); bull / bear / warn reserved for
// meaning. Type scale: 11 meta, 12-13 UI, 14 numbers, 16 panel
// headings, 20-24 ticker.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#080C12",
          panel: "#0D131B",
          card: "#111A24",
          elevated: "#16212D",
          hover: "#1B2836",
        },
        border: {
          DEFAULT: "#22303D",
          light: "#2C3D4D",
          glow: "#2C3D4D",
        },
        brand: {
          DEFAULT: "#4C9AFF",
          glow: "#7DB5FF",
          deep: "#2F6FCC",
        },
        mine: "#B08CFF",
        bull: "#21C987",
        bear: "#F45B69",
        warn: "#E5AE45",
        ink: {
          DEFAULT: "#E8EDF2",
          muted: "#84909D",
          faint: "#5E6B78",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        xs: ["11px", { lineHeight: "16px" }],
        sm: ["12px", { lineHeight: "16px" }],
        base: ["13px", { lineHeight: "18px" }],
        md: ["14px", { lineHeight: "20px" }],
        lg: ["16px", { lineHeight: "22px" }],
        xl: ["20px", { lineHeight: "26px" }],
        "2xl": ["24px", { lineHeight: "30px" }],
        "3xl": ["30px", { lineHeight: "36px" }],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 6px 20px -12px rgba(0,0,0,0.7)",
        pop: "0 10px 30px -10px rgba(0,0,0,0.8), 0 0 0 1px #22303D",
        glow: "0 0 0 1px rgba(76,154,255,0.25)",
      },
      borderRadius: {
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
        xl: "10px",
        "2xl": "14px",
      },
      spacing: {
        4.5: "18px",
      },
      transitionDuration: {
        DEFAULT: "120ms",
      },
    },
  },
  plugins: [],
};

export default config;
