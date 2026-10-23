import { swatchFor } from '@/features/chip-inventory/photo/to-rows';
import { colourChange, newRow, rowsFromInventory, type ChipRow } from './rows';

// Spec 09 §4.3: an unpicked swatch follows the colour name; a picked or saved one stays.

const type = (row: ChipRow, colour: string): ChipRow => ({ ...row, ...colourChange(row, colour) });

describe('colourChange', () => {
  it('follows the colour name while the swatch is unpicked', () => {
    const red = type(newRow('r1'), 'Red');
    expect(red.swatch).toBe(swatchFor('red'));
    expect(type(red, 'Dark blue').swatch).toBe(swatchFor('blue'));
  });

  it('keeps the last swatch through half-typed or unknown names, then follows again', () => {
    const red = type(newRow('r1'), 'Red');
    const partial = type(red, 'Re');
    expect(partial).toMatchObject({ colour: 'Re', swatch: swatchFor('red') });
    expect(type(partial, 'Bluee').swatch).toBe(swatchFor('red'));
    expect(type(type(partial, 'Bluee'), 'Blue').swatch).toBe(swatchFor('blue'));
  });

  it('leaves a picked swatch alone', () => {
    const picked: ChipRow = { ...newRow('r1'), swatch: '#123456', swatchPicked: true };
    expect(type(picked, 'Red')).toMatchObject({ colour: 'Red', swatch: '#123456' });
  });

  it('treats a saved chip set swatch as picked', () => {
    const [row] = rowsFromInventory({
      id: 'inv',
      schemaVersion: 1,
      name: 'Set',
      updatedAt: 0,
      chipTypes: [
        { id: 'c1', colour: 'Red', swatch: '#aa0000', quantity: 50, confirmed: true },
      ],
    } as never);
    expect(row?.swatchPicked).toBe(true);
    expect(row && type(row, 'Green').swatch).toBe('#aa0000');
  });
});
