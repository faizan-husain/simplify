import en from './en.json';

type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`;
}[keyof ObjectType & (string | number)];

export type TranslationKey = NestedKeyOf<typeof en>;

export function t(key: string, vars?: Record<string, string | number>): string {
  const parts = key.split('.');
  let current: any = en;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return key; // Fallback to key if not found
    }
  }

  if (typeof current !== 'string') {
    return key;
  }

  let text = current;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      text = text.replace(new RegExp(`{${k}}`, 'g'), String(v));
    });
  }

  return text;
}

export function getErrorMessage(errorCodeOrMessage: string): string {
  if (!errorCodeOrMessage) return t('errors.generic');

  // Check if error code directly maps to known error
  const directKey = `errors.${errorCodeOrMessage}`;
  const translated = t(directKey);
  if (translated !== directKey) {
    return translated;
  }

  // Check if standard Postgres error or substring contains known code
  const knownCodes = [
    'CUSTOMER_REQUIRED_FOR_DUE',
    'INVOICE_LOCKED',
    'ALLOCATION_INCOMPLETE',
    'JOB_HAS_PROGRESS',
    'UNAUTHORIZED',
    'DUPLICATE_MOBILE',
    'INVALID_PIN',
    'INVALID_QUANTITY_PRECISION',
    'INVALID_QUANTITY_MIN',
    'INVALID_QUANTITY'
  ];

  for (const code of knownCodes) {
    if (errorCodeOrMessage.includes(code)) {
      return t(`errors.${code}`);
    }
  }

  return errorCodeOrMessage.length < 80 ? errorCodeOrMessage : t('errors.generic');
}
