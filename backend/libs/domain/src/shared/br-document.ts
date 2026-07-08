/**
 * Validação de documentos fiscais brasileiros (CPF / CNPJ).
 *
 * `documentType` casa com o tipo de conta do sign-up: pessoa física (CPF) para
 * contas `streamer`/`creator`, pessoa jurídica (CNPJ) para `agency`/`brand`.
 * Guardamos sempre **apenas os dígitos** (sem máscara).
 */
export type DocumentType = 'cpf' | 'cnpj';

/** Remove tudo que não for dígito. */
export function onlyDigits(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Valida um CPF (11 dígitos) pelos dígitos verificadores. */
export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  // rejeita sequências repetidas (000..., 111..., etc.)
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map(Number);
  for (let check = 9; check < 11; check++) {
    let sum = 0;
    for (let i = 0; i < check; i++) {
      sum += digits[i] * (check + 1 - i);
    }
    let mod = (sum * 10) % 11;
    if (mod === 10) mod = 0;
    if (mod !== digits[check]) return false;
  }
  return true;
}

/** Valida um CNPJ (14 dígitos) pelos dígitos verificadores. */
export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const digits = cnpj.split('').map(Number);
  const weightsFirst = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weightsSecond = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const calc = (weights: number[]): number => {
    const sum = weights.reduce((acc, w, i) => acc + digits[i] * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  return calc(weightsFirst) === digits[12] && calc(weightsSecond) === digits[13];
}

/** Valida `value` de acordo com o `type` informado. */
export function isValidDocument(type: DocumentType, value: string): boolean {
  return type === 'cpf' ? isValidCpf(value) : isValidCnpj(value);
}
