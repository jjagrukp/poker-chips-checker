import { chipContrast, chipValueLabel } from './chip-colour';

describe('chipContrast', () => {
  it('puts dark inserts on light chips and light inserts on dark ones', () => {
    expect(chipContrast('#ffffff')).toBe('#1d2233');
    expect(chipContrast('#f5f5f5')).toBe('#1d2233');
    expect(chipContrast('#fbc02d')).toBe('#1d2233');
    expect(chipContrast('#1f1f1f')).toBe('#f6f3ea');
    expect(chipContrast('#c62828')).toBe('#f6f3ea');
    expect(chipContrast('#1e63c4')).toBe('#f6f3ea');
  });

  it('accepts short hex and treats nonsense as a dark chip', () => {
    expect(chipContrast('#fff')).toBe('#1d2233');
    expect(chipContrast('not a colour')).toBe('#f6f3ea');
  });
});

describe('chipValueLabel', () => {
  it('shortens values to fit inside a chip', () => {
    expect(chipValueLabel(25)).toBe('25');
    expect(chipValueLabel(500)).toBe('500');
    expect(chipValueLabel(1000)).toBe('1K');
    expect(chipValueLabel(2500)).toBe('2.5K');
    expect(chipValueLabel(25_000)).toBe('25K');
    expect(chipValueLabel(1_500_000)).toBe('1.5M');
  });
});
