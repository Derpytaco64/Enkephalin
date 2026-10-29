import { YEAR_LEVELS, type FieldDataType, type FieldDefInput } from './constants';

/** An unchecked checkbox is absent from the payload rather than false. */
function flag(formData: FormData, name: string) {
  return formData.get(name) !== null;
}

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? '');
}

export function readFieldDefInput(formData: FormData): FieldDefInput {
  return {
    label: text(formData, 'label'),
    group: text(formData, 'group'),
    dataType: (text(formData, 'dataType') || 'markdown') as FieldDataType,
    enumOptions: text(formData, 'enumOptions')
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean),
    sortOrder: Number(formData.get('sortOrder') ?? 0),
    yearLevels: YEAR_LEVELS.filter((year) => flag(formData, `year_${year}`)),
    blankMeansNone: flag(formData, 'blankMeansNone'),
    isQuizzable: flag(formData, 'isQuizzable'),
    defaultVisible: flag(formData, 'defaultVisible'),
    helpText: text(formData, 'helpText'),
    promptTemplate: text(formData, 'promptTemplate'),
  };
}
