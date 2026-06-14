import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0e17",
          card: "#111722",
          elevated: "#161d2b",
          hover: "#1c2433",
        },
        border: {
          DEFAULT: "#1f2937",
          light: "#2a3546",
        },
        brand: {
          DEFAULT: "#3b82f6",
          glow: "#60a5fa",
        },
        bull: "#16c784",
        bear: "#ea3943",
        warn: "#f0b90b",
        ink: {
          DEFAULT: "#e8edf5",
          muted: "#8b97a8",
          faint: "#5a6678",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
