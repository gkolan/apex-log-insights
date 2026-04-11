import { describe, it, expect } from 'vitest';
import { redactReport } from '../src/redact.js';

describe('redactReport', () => {
  it('redacts Salesforce IDs', () => {
    const input = {
      recordId: '001xx000003DGWI',
      anotherId: '005xx0000012345AAA',
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.recordId).toContain('[REDACTED-ID]');
    expect(result.anotherId).toContain('[REDACTED-ID]');
  });

  it('redacts email addresses', () => {
    const input = {
      email: 'user@example.com',
      contact: 'support@acme.org',
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.email).toContain('[REDACTED-EMAIL]');
    expect(result.contact).toContain('[REDACTED-EMAIL]');
  });

  it('redacts phone numbers', () => {
    const input = {
      phone: '(555) 123-4567',
      intlPhone: '+1-555-123-4567',
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.phone).toContain('[REDACTED-PHONE]');
    expect(result.intlPhone).toContain('[REDACTED-PHONE]');
  });

  it('fully redacts message fields', () => {
    const input = {
      message: 'User debug: john@example.com and 001xx000003DGWI',
      debugString: 'Customer name: John Smith, ID: 005xx0000012345AA',
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.message).toBe('[REDACTED]');
    expect(result.debugString).toBe('[REDACTED]');
  });

  it('preserves structural fields', () => {
    const input = {
      className: 'MyApexClass',
      methodName: 'processRecords',
      fieldName: 'customField__c',
      sObjectType: 'Account',
      count: 42,
      duration: 1250,
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.className).toBe('MyApexClass');
    expect(result.methodName).toBe('processRecords');
    expect(result.fieldName).toBe('customField__c');
    expect(result.sObjectType).toBe('Account');
    expect(result.count).toBe(42);
    expect(result.duration).toBe(1250);
  });

  it('deep-walks nested objects', () => {
    const input = {
      events: [
        {
          message: 'Debug: user@example.com',
          className: 'MyClass',
        },
        {
          message: 'Error: ID 001xx000003DGWI not found',
          methodName: 'findRecord',
        },
      ],
    };
    const result = redactReport(input) as Record<string, unknown>;
    const events = result.events as Array<Record<string, unknown>>;
    expect(events[0].message).toBe('[REDACTED]');
    expect(events[0].className).toBe('MyClass');
    expect(events[1].message).toBe('[REDACTED]');
    expect(events[1].methodName).toBe('findRecord');
  });

  it('respects redaction options', () => {
    const input = {
      email: 'user@example.com',
      phone: '(555) 123-4567',
      recordId: '001xx000003DGWI',
    };

    // Only redact emails
    const result = redactReport(input, { email: true, sfId: false, phone: false }) as Record<
      string,
      unknown
    >;
    expect(result.email).toContain('[REDACTED-EMAIL]');
    expect(result.phone).toBe('(555) 123-4567'); // Not redacted
    expect(result.recordId).toBe('001xx000003DGWI'); // Not redacted
  });

  it('handles null and undefined values', () => {
    const input = {
      nullValue: null,
      undefinedValue: undefined,
      normalString: 'test@example.com',
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.nullValue).toBeNull();
    expect(result.undefinedValue).toBeUndefined();
    expect(result.normalString).toContain('[REDACTED-EMAIL]');
  });

  it('does not mutate original object', () => {
    const input = {
      email: 'user@example.com',
      className: 'MyClass',
    };
    const original = JSON.stringify(input);
    redactReport(input);
    expect(JSON.stringify(input)).toBe(original);
  });
});
