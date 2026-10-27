import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { decideSignUp, onboardingSteps, signUpMerchant } from '../src/signup';
import { prisma, resetDatabase } from './helpers';

let admin: string;
const input = {
  businessName: 'Nile Beauty',
  contactName: 'Hana Fathy',
  email: 'hana@nile.example',
  phone: '+201012345678',
  password: 'a-long-password-1',
  shopDomain: 'nile-beauty.myshopify.com',
};

beforeEach(async () => {
  await resetDatabase();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
});

afterAll(() => prisma.$disconnect());

describe('merchant self sign up', () => {
  it('waits for admin, then approval opens the merchant and its user', async () => {
    const { merchantId } = await signUpMerchant(prisma, input);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: input.email } });
    expect(user).toMatchObject({ isActive: false, role: 'merchant', merchantId });
    expect(await prisma.alert.count({ where: { type: 'merchant_signup', resolvedAt: null } })).toBe(
      1,
    );

    await decideSignUp(prisma, { merchantId, approve: true, actorUserId: admin });
    expect(await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } })).toMatchObject({
      approval: 'approved',
      isActive: true,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(true);
    expect(await prisma.alert.count({ where: { type: 'merchant_signup', resolvedAt: null } })).toBe(
      0,
    );
    await expect(
      decideSignUp(prisma, { merchantId, approve: true, actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'not_pending' });
    expect(await onboardingSteps(prisma, merchantId)).toEqual({
      products: false,
      price: false,
      shopify: false,
      shipment: false,
    });
  });

  it('needs a reason to reject and keeps the account closed', async () => {
    const { merchantId } = await signUpMerchant(prisma, input);
    await expect(
      decideSignUp(prisma, { merchantId, approve: false, actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await decideSignUp(prisma, {
      merchantId,
      approve: false,
      reason: 'Outside Cairo',
      actorUserId: admin,
    });
    expect(await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } })).toMatchObject({
      approval: 'rejected',
      isActive: false,
      rejectReason: 'Outside Cairo',
    });
  });

  it('refuses an email or phone already in use, writing nothing', async () => {
    await signUpMerchant(prisma, input);
    await expect(
      signUpMerchant(prisma, { ...input, phone: '+201112345678' }),
    ).rejects.toMatchObject({
      code: 'email_taken',
    });
    await expect(
      signUpMerchant(prisma, { ...input, email: 'other@nile.example' }),
    ).rejects.toMatchObject({
      code: 'phone_taken',
    });
    expect(await prisma.merchant.count()).toBe(1);
  });
});
