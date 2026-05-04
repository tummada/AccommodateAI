// sender.test.ts — Unit tests for sendEmail with retry logic
// Mocks nodemailer — never calls real SMTP

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock nodemailer ──────────────────────────────────────────────────────────
const mockSendMail = vi.fn();
const mockCreateTransport = vi.fn(() => ({ sendMail: mockSendMail }));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mockCreateTransport,
  },
}));

// Import after mocks (nodemailer mock is set up above)
const { sendEmail } = await import('./sender.js');

beforeEach(() => {
  vi.clearAllMocks();
  // Use fake timers to speed up sleep delays
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sendEmail', () => {
  it('sends email successfully on first attempt', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'test-id' });

    const promise = sendEmail('to@example.com', 'Subject', '<p>html</p>', 'plain text');
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith({
      from: `Pon from VOLLOS <${process.env['GMAIL_USER']}>`,
      to: 'to@example.com',
      subject: 'Subject',
      html: '<p>html</p>',
      text: 'plain text',
      headers: {},
    });
  });

  it('retries on failure and succeeds on 2nd attempt', async () => {
    mockSendMail
      .mockRejectedValueOnce(new Error('SMTP timeout'))
      .mockResolvedValueOnce({ messageId: 'ok' });

    const promise = sendEmail('to@example.com', 'Subject', '<p>html</p>', 'text');
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  it('retries on failure and succeeds on 3rd attempt', async () => {
    mockSendMail
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce({ messageId: 'ok' });

    const promise = sendEmail('to@example.com', 'Subject', '<p>html</p>', 'text');
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSendMail).toHaveBeenCalledTimes(3);
  });

  it('exhausts all retries and does NOT throw (logs error instead)', async () => {
    mockSendMail
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const promise = sendEmail('fail@example.com', 'Subject', '<p>html</p>', 'text');
    await vi.runAllTimersAsync();

    // Should NOT throw
    await expect(promise).resolves.toBeUndefined();

    // Should have logged errors
    expect(consoleSpy).toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalledTimes(3);

    consoleSpy.mockRestore();
  });

  it('uses process.env for OAuth2 credentials — no hardcoded secrets', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'ok' });

    const promise = sendEmail('to@example.com', 'Subject', '<p>html</p>', 'text');
    await vi.runAllTimersAsync();
    await promise;

    // createTransport should be called with OAuth2 config using process.env
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          type: 'OAuth2',
          user: process.env['GMAIL_USER'],
          clientId: process.env['GOOGLE_CLIENT_ID'],
          clientSecret: process.env['GOOGLE_CLIENT_SECRET'],
          refreshToken: process.env['GOOGLE_REFRESH_TOKEN'],
        }),
      })
    );
  });

  it('logs final error after all retries with recipient address', async () => {
    mockSendMail
      .mockRejectedValueOnce(new Error('err'))
      .mockRejectedValueOnce(new Error('err'))
      .mockRejectedValueOnce(new Error('err'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const promise = sendEmail('specific@example.com', 'Subject', '<p>html</p>', 'text');
    await vi.runAllTimersAsync();
    await promise;

    // Should log the final failure message containing masked recipient (sp***@example.com)
    const calls = consoleSpy.mock.calls.map((args) => args.join(' '));
    const finalErrorLog = calls.find((msg) => msg.includes('sp***@example.com'));
    expect(finalErrorLog).toBeDefined();

    consoleSpy.mockRestore();
  });
});
