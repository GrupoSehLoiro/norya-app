/**
 * Unit — entidades de tenancy/billing + invariantes (Fase 1).
 */
import { Workspace } from './workspace.entity';
import { Membership, wsRoleSatisfies, WS_ROLE_RANK } from './membership.entity';
import { EmailVerificationCode } from './email-verification-code.entity';
import { PLANS, getPlan, planHasFeature, withinLimit, FEATURES } from './billing/plans';
import { CreatorProfile } from '../creator/creator-profile.entity';

describe('Workspace', () => {
  it('cria com slug derivado, plano free e status active por default', () => {
    const ws = Workspace.create({ name: 'YoDa Studios', ownerUserId: 'u1' });
    expect(ws.getSlug()).toBe('yoda-studios');
    expect(ws.getType()).toBe('creator');
    expect(ws.getPlanKey()).toBe('free');
    expect(ws.getSubscriptionStatus()).toBe('active');
    expect(ws.getOwnerUserId()).toBe('u1');
  });

  it('valida name e ownerUserId', () => {
    expect(() => Workspace.create({ name: '', ownerUserId: 'u1' })).toThrow();
    expect(() => Workspace.create({ name: 'x', ownerUserId: '' })).toThrow();
  });

  it('rename atualiza name e slug', () => {
    const ws = Workspace.create({ name: 'A', ownerUserId: 'u1' });
    ws.rename('Nova Marca');
    expect(ws.getName()).toBe('Nova Marca');
    expect(ws.getSlug()).toBe('nova-marca');
  });

  it('roundtrip persistence', () => {
    const ws = Workspace.create({ name: 'A', ownerUserId: 'u1' });
    const back = Workspace.reconstitute(ws.toPersistence());
    expect(back.getId()).toBe(ws.getId());
    expect(back.getSlug()).toBe(ws.getSlug());
  });
});

describe('Membership / RBAC', () => {
  it('hierarquia: owner > admin > manager > analyst > viewer', () => {
    expect(WS_ROLE_RANK.owner).toBeGreaterThan(WS_ROLE_RANK.admin);
    expect(WS_ROLE_RANK.analyst).toBeGreaterThan(WS_ROLE_RANK.viewer);
  });

  it('wsRoleSatisfies respeita a hierarquia', () => {
    expect(wsRoleSatisfies('owner', 'manager')).toBe(true);
    expect(wsRoleSatisfies('manager', 'manager')).toBe(true);
    expect(wsRoleSatisfies('analyst', 'manager')).toBe(false);
    expect(wsRoleSatisfies('viewer', 'analyst')).toBe(false);
  });

  it('create default status active; revoke/activate alternam', () => {
    const m = Membership.create({ workspaceId: 'w1', userId: 'u1', role: 'owner' });
    expect(m.isActive()).toBe(true);
    m.revoke();
    expect(m.isActive()).toBe(false);
    m.activate();
    expect(m.isActive()).toBe(true);
  });
});

describe('EmailVerificationCode', () => {
  it('expira corretamente', () => {
    const past = new Date(Date.now() - 1000);
    const code = EmailVerificationCode.create({
      userId: 'u1',
      email: 'a@b.com',
      codeHash: 'h',
      expiresAt: past,
    });
    expect(code.isExpired()).toBe(true);
  });

  it('limita tentativas e consome', () => {
    const code = EmailVerificationCode.create({
      userId: 'u1',
      email: 'a@b.com',
      codeHash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(code.canAttempt(3)).toBe(true);
    code.registerAttempt();
    code.registerAttempt();
    code.registerAttempt();
    expect(code.canAttempt(3)).toBe(false);
    expect(code.isConsumed()).toBe(false);
    code.consume();
    expect(code.isConsumed()).toBe(true);
  });
});

describe('Plans / entitlements', () => {
  it('free é o plano default e mais restrito', () => {
    expect(getPlan('free').maxCreators).toBe(1);
    expect(getPlan('free').maxIntegrationsPerCreator).toBe(1);
  });

  it('agency permite múltiplos creators e marcas ilimitadas', () => {
    expect(PLANS.agency.maxCreators).toBe(10);
    expect(PLANS.agency.maxBrands).toBe(-1);
  });

  it('withinLimit trata -1 como ilimitado', () => {
    expect(withinLimit(999, -1)).toBe(true);
    expect(withinLimit(0, 1)).toBe(true);
    expect(withinLimit(1, 1)).toBe(false);
  });

  it('planHasFeature: pdf só do pro pra cima', () => {
    expect(planHasFeature('free', FEATURES.REPORTS_PDF)).toBe(false);
    expect(planHasFeature('pro', FEATURES.REPORTS_PDF)).toBe(true);
  });
});

describe('CreatorProfile', () => {
  it('update aplica patch parcial e markComplete marca completo', () => {
    const p = CreatorProfile.create({ creatorId: 'c1' });
    expect(p.isComplete()).toBe(false);
    p.update({ category: 'games', niche: 'fps' });
    p.markComplete();
    expect(p.isComplete()).toBe(true);
    const back = CreatorProfile.reconstitute(p.toPersistence());
    expect(back.isComplete()).toBe(true);
  });
});
