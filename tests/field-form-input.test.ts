import { describe, expect, it } from 'vitest';
import { readFieldDefInput } from '@/lib/fields/form-input';

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe('readFieldDefInput', () => {
  it('reads a filled-in form', () => {
    const input = readFieldDefInput(
      form({
        label: '  Half life  ',
        group: ' Clinical ',
        dataType: 'number',
        sortOrder: '65',
        year_P2: 'on',
        year_P3: 'on',
        blankMeansNone: 'on',
        isQuizzable: 'on',
        defaultVisible: 'on',
        helpText: 'Hours',
        promptTemplate: 'Half life of {{generic}}?',
      }),
    );

    expect(input).toMatchObject({
      label: '  Half life  ',
      dataType: 'number',
      sortOrder: 65,
      yearLevels: ['P2', 'P3'],
      blankMeansNone: true,
      isQuizzable: true,
      defaultVisible: true,
    });
  });

  it('treats an absent checkbox as false rather than missing', () => {
    // Browsers omit unchecked boxes entirely, so a form that turns a flag off
    // sends nothing for it. Reading that as undefined would leave the old
    // value in place and make the toggle one-way.
    const input = readFieldDefInput(form({ label: 'X', dataType: 'text' }));

    expect(input.blankMeansNone).toBe(false);
    expect(input.isQuizzable).toBe(false);
    expect(input.defaultVisible).toBe(false);
    expect(input.yearLevels).toEqual([]);
  });

  it('splits enum options on commas and drops the blanks', () => {
    const input = readFieldDefInput(
      form({ label: 'Route', dataType: 'enum', enumOptions: ' oral , IV ,, topical ,' }),
    );
    expect(input.enumOptions).toEqual(['oral', 'IV', 'topical']);
  });

  it('defaults the data type and sort order when the form omits them', () => {
    const input = readFieldDefInput(form({ label: 'X' }));
    expect(input.dataType).toBe('markdown');
    expect(input.sortOrder).toBe(0);
  });

  it('ignores a year checkbox that is not a program year', () => {
    const input = readFieldDefInput(form({ label: 'X', dataType: 'text', year_P9: 'on' }));
    expect(input.yearLevels).toEqual([]);
  });
});
