/**
 * Ambient liquid blobs — fixed full-viewport background.
 * Three GPU-isolated blobs floating slowly. Auto-disabled by
 * prefers-reduced-motion (handled in globals.css).
 */
export function Ambient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <span
        className="liquid-blob"
        style={{
          width: 720,
          height: 720,
          top: -260,
          left: -220,
          // Stop intermediário em 40% segura a cor mais espalhada (menos
          // hotspot central) e o fade vai até 85% (mais difuso nas bordas).
          background:
            'radial-gradient(circle, #d7fe01 0%, rgba(215,254,1,0.45) 40%, transparent 85%)',
          opacity: 0.18,
        }}
      />
      <span
        className="liquid-blob liquid-blob--reverse"
        style={{
          width: 560,
          height: 560,
          bottom: -160,
          right: -200,
          background: 'radial-gradient(circle, #a8c800 0%, transparent 70%)',
        }}
      />
      {/* Footer wash — esticado horizontal, formato orgânico via
          border-radius assimétrico. Mesma paleta lime dos outros blobs. */}
      <span
        className="liquid-blob"
        style={{
          width: '70vw',
          height: 260,
          bottom: -110,
          left: '-8vw',
          // Concentra no lado esquerdo — deixa a metade direita da viewport
          // em "negativo" (sem blob), o que reforça o contraste assimétrico.
          background:
            'radial-gradient(ellipse 60% 80% at 28% 45%, #d7fe01 0%, transparent 65%),' +
            'radial-gradient(ellipse 50% 75% at 62% 60%, #a8c800 0%, transparent 70%)',
          borderRadius: '62% 38% 8% 12% / 78% 64% 12% 18%',
          opacity: 0.38,
          animationDuration: '38s',
        }}
      />
    </div>
  );
}
