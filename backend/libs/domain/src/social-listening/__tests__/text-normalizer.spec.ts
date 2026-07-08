import { normalizeText, tokenize, copypastaKey } from '../text-normalizer';

describe('normalizeText', () => {
  it('lowercase + collapse whitespace por default', () => {
    expect(normalizeText('  PogChamp   LETSGO  ')).toBe('pogchamp letsgo');
  });

  it('strip URLs', () => {
    expect(normalizeText('olha https://exemplo.com/x agora')).toBe('olha agora');
  });

  it('strip @mentions', () => {
    expect(normalizeText('oi @YoDa tudo bem')).toBe('oi tudo bem');
  });

  it('preserva acentos por default ("não" continua "não")', () => {
    expect(normalizeText('Não vou')).toBe('não vou');
  });

  it('strip accents quando solicitado', () => {
    expect(normalizeText('Não vou', { stripAccents: true })).toBe('nao vou');
  });
});

describe('tokenize', () => {
  it('remove stopwords pt-BR default', () => {
    expect(tokenize('esse cara é muito pog mano')).toEqual(['pog']);
  });

  it('ignora tokens com menos de 2 chars', () => {
    expect(tokenize('o a b cd ef')).toEqual(['cd', 'ef']);
  });

  it('preserva "não" (negação)', () => {
    expect(tokenize('não gostei do jogo')).toEqual(['não', 'gostei', 'jogo']);
  });

  it('strip pontuação de borda', () => {
    expect(tokenize('rage!!! triste...')).toEqual(['rage', 'triste']);
  });
});

describe('copypastaKey', () => {
  it('mesma forma para variações de espaçamento e mention', () => {
    const a = copypastaKey('  pogchamp letsgo @bob ');
    const b = copypastaKey('PogChamp   LETSGO');
    expect(a).toBe(b);
  });
});
