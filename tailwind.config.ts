import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surface scale
        surface: {
          0: '#05080F',   // page bg
          1: '#0C1220',   // card
          2: '#121A2E',   // elevated card
          3: '#1A2440',   // hover
        },
        // Primary brand (indigo → violet)
        brand: {
          DEFAULT: '#6366F1',
          light:   '#818CF8',
          dark:    '#4F46E5',
          dim:     'rgba(99,102,241,0.15)',
          glow:    'rgba(99,102,241,0.25)',
        },
        // Data colors
        up: {
          DEFAULT: '#00C9A7',
          dim:     'rgba(0,201,167,0.12)',
          border:  'rgba(0,201,167,0.25)',
        },
        down: {
          DEFAULT: '#F43F5E',
          dim:     'rgba(244,63,94,0.12)',
          border:  'rgba(244,63,94,0.25)',
        },
        // Text scale
        ink: {
          1: '#EEF2FF',
          2: '#94A3B8',
          3: '#475569',
        },
        // Borders
        line: {
          DEFAULT: 'rgba(255,255,255,0.07)',
          bright:  'rgba(255,255,255,0.14)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'Consolas', 'monospace'],
      },
      backgroundImage: {
        'mesh-radial':
          'radial-gradient(ellipse 90% 60% at 5% -5%, rgba(99,102,241,0.07) 0%, transparent 55%), ' +
          'radial-gradient(ellipse 70% 50% at 95% 105%, rgba(56,189,248,0.05) 0%, transparent 55%)',
        'brand-gradient': 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
        'brand-gradient-subtle': 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.08) 100%)',
        'card-shine': 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 60%)',
      },
      boxShadow: {
        'brand':    '0 4px 24px rgba(99,102,241,0.35), 0 1px 0 rgba(255,255,255,0.1) inset',
        'card':     '0 4px 32px rgba(0,0,0,0.5)',
        'card-hover': '0 8px 40px rgba(0,0,0,0.6)',
        'up':       '0 0 20px rgba(0,201,167,0.2)',
        'down':     '0 0 20px rgba(244,63,94,0.2)',
        'glow-sm':  '0 0 12px rgba(99,102,241,0.3)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
      },
    },
  },
  plugins: [],
}

export default config
