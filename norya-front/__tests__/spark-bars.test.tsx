import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SparkBars } from '@/components/metrics/spark-bars';

describe('<SparkBars />', () => {
  it('renderiza N rects pra N valores', () => {
    const { container } = render(<SparkBars values={[1, 2, 3, 4]} />);
    expect(container.querySelectorAll('rect').length).toBe(4);
  });

  it('mostra fallback quando values vazio', () => {
    const { container } = render(<SparkBars values={[]} />);
    expect(container.textContent).toContain('sem dados');
  });

  it('escala altura pelo max', () => {
    const { container } = render(<SparkBars values={[10, 100]} />);
    const rects = container.querySelectorAll('rect');
    const h0 = parseFloat(rects[0]!.getAttribute('height')!);
    const h1 = parseFloat(rects[1]!.getAttribute('height')!);
    expect(h1).toBeGreaterThan(h0);
  });
});
