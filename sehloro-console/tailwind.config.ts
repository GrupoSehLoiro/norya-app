import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Foundation tokens → CSS variables (ver globals.css :root / html.light).
        // Permite alternar dark (padrão) ↔ light sem reescrever componentes.
        bg: {
          0: 'var(--c-bg-0)',
          1: 'var(--c-bg-1)',
          2: 'var(--c-bg-2)',
        },
        ink: {
          50:  'var(--c-ink-50)',
          100: 'var(--c-ink-100)',
          200: 'var(--c-ink-200)',
          300: 'var(--c-ink-300)',
          400: 'var(--c-ink-400)',
          500: 'var(--c-ink-500)',
          600: 'var(--c-ink-600)',
          700: 'var(--c-ink-700)',
          800: 'var(--c-ink-800)',
          900: 'var(--c-ink-900)',
        },
        accent: {
          50:  'rgba(215,254,1,0.06)',
          100: 'rgba(215,254,1,0.10)',
          200: 'rgba(215,254,1,0.18)',
          300: '#e8ff7a',
          400: '#d7fe01',
          500: '#d7fe01',
          600: '#a8c800',
          700: '#94b000',
        },
        positive: '#6ee7b7',
        negative: '#f87171',
        warn:     '#fbbf24',
        ok:       '#6ee7b7',
        err:      '#f87171',
        platform: {
          twitch: '#a78bfa',
          kick:   '#6ee7b7',
        },
      },
      fontFamily: {
        sans: ['Satoshi', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgba(0,0,0,0.30), 0 1px 1px 0 rgba(0,0,0,0.20)',
        elevated: '0 16px 40px rgba(0,0,0,0.45)',
        glass:
          'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 -1px 0 rgba(255,255,255,0.03), 0 20px 50px rgba(0,0,0,0.45)',
        'glass-hover':
          'inset 0 1px 0 rgba(255,255,255,0.20), inset 0 0 0 1px rgba(255,255,255,0.10), inset 0 -1px 0 rgba(255,255,255,0.04), 0 24px 60px rgba(0,0,0,0.50)',
        'glass-dock':
          'inset 0 1px 0 rgba(255,255,255,0.06), 0 14px 40px rgba(0,0,0,0.45)',
      },
      transitionTimingFunction: {
        glass: 'cubic-bezier(0.23, 1, 0.32, 1)',
        soft:  'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'liquid-float': {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '25%':     { transform: 'translate(30px,-20px) scale(1.05)' },
          '50%':     { transform: 'translate(-20px,15px) scale(0.95)' },
          '75%':     { transform: 'translate(15px,25px) scale(1.02)' },
        },
        'liquid-float-reverse': {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '25%':     { transform: 'translate(-25px,20px) scale(0.97)' },
          '50%':     { transform: 'translate(20px,-15px) scale(1.04)' },
          '75%':     { transform: 'translate(-10px,-25px) scale(0.98)' },
        },
        'led-halo': {
          '0%,100%': { transform: 'scale(1)',    opacity: '0.18' },
          '50%':     { transform: 'scale(1.55)', opacity: '0.05' },
        },
        'card-glow-fade': {
          '0%,100%': { opacity: '0.35' },
          '50%':     { opacity: '1' },
        },
        'sse-pulse': {
          '0%':   { transform: 'scale(0.6)', opacity: '0.9' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
      },
      animation: {
        'liquid-float':         'liquid-float 28s ease-in-out infinite',
        'liquid-float-reverse': 'liquid-float-reverse 32s ease-in-out infinite',
        'led-halo':             'led-halo 2.4s ease-in-out infinite',
        'card-glow-fade':       'card-glow-fade 4s ease-in-out infinite',
        'sse-pulse':            'sse-pulse 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
