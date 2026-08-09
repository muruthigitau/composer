/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      container: {
        center: true
      },
      fontFamily: {
        sans: [
          "var(--font-family)",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "sans-serif"
        ],
        mono: [
          "var(--code-font-family)",
          '"Fira Code"',
          '"Courier New"',
          "monospace"
        ]
      },
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          input: "var(--bg-input)",
          card: "var(--bg-card)",
          hover: "var(--bg-hover)",
          active: "var(--bg-active)"
        },
        text: {
          primary: "var(--text-primary)",
          muted: "var(--text-muted)",
          disabled: "var(--text-disabled)",
          link: "var(--text-link)"
        },
        border: {
          DEFAULT: "var(--border-color)",
          input: "var(--input-border)"
        },
        focus: {
          DEFAULT: "var(--focus-border)"
        },
        button: {
          bg: "var(--button-bg)",
          fg: "var(--button-fg)",
          hover: "var(--button-hover)",
          secondaryBg: "var(--button-secondary-bg)",
          secondaryFg: "var(--button-secondary-fg)"
        },
        diff: {
          addBg: "var(--diff-add-bg)",
          addBorder: "var(--diff-add-border)",
          addText: "var(--diff-add-text)",
          removeBg: "var(--diff-remove-bg)",
          removeBorder: "var(--diff-remove-border)",
          removeText: "var(--diff-remove-text)",
          hunkBg: "var(--diff-hunk-bg)",
          hunkText: "var(--diff-hunk-text)",
          contextText: "var(--diff-context-text)"
        },
        alert: {
          warningBg: "var(--warning-bg)",
          warningBorder: "var(--warning-border)",
          warningText: "var(--warning-text)",
          errorBg: "var(--error-bg)",
          errorBorder: "var(--error-border)",
          errorText: "var(--error-text)",
          infoBg: "var(--info-bg)",
          infoBorder: "var(--info-border)",
          infoText: "var(--info-text)",
          successBg: "var(--success-bg)",
          successText: "var(--success-text)"
        },
        scrollbar: {
          thumb: "var(--scrollbar-thumb)",
          hover: "var(--scrollbar-hover)",
          active: "var(--scrollbar-active)"
        },
        peek: "var(--peek-bg)",
        quickPickBg: "var(--quick-pick-bg)",
        quickPickFg: "var(--quick-pick-fg)"
      },
      boxShadow: {
        card: "0 1px 2px rgba(0, 0, 0, 0.15)",
        button: "0 1px 2px rgba(0, 0, 0, 0.2)",
        "button-hover": "0 2px 4px rgba(0, 0, 0, 0.25)",
        modal: "0 20px 60px rgba(0, 0, 0, 0.6)",
        "modal-sm": "0 20px 60px rgba(0, 0, 0, 0.5)",
        "quick-pick": "0 10px 30px rgba(0, 0, 0, 0.4)",
        overlay: "0 -20px 60px rgba(0, 0, 0, 0.5)"
      },
      animation: {
        "modal-fade-in": "modal-fade-in 0.3s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
        "slide-down": "slide-down 0.25s ease-out",
        "qp-in": "qp-in 0.15s ease-out",
        "pr-in": "qp-in 0.2s ease-out",
        "banner-in": "banner-in 0.2s ease-out",
        "dot-bounce": "dot-bounce 1.4s infinite both",
        spin: "spin 0.8s linear infinite"
      },
      keyframes: {
        "modal-fade-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" }
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(-10px)" },
          to: { opacity: "1", transform: "translateX(0)" }
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        "qp-in": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        "banner-in": {
          from: { opacity: "0", transform: "translateY(-6px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        "dot-bounce": {
          "0%, 80%, 100%": { transform: "scale(0)", opacity: "0.3" },
          "40%": { transform: "scale(1)", opacity: "1" }
        },
        spin: {
          to: { transform: "rotate(360deg)" }
        }
      }
    }
  },
  plugins: []
};