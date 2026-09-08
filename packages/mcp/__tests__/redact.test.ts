import { describe, it, expect } from "vitest";
import { redactReport } from "../src/redact.js";

describe("redactReport", () => {
  it("redacts Salesforce IDs", () => {
    const input = {
      recordId: "001xx000003DGWI",
      anotherId: "005xx0000012345AAA",
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.recordId).toContain("[REDACTED-ID]");
    expect(result.anotherId).toContain("[REDACTED-ID]");
  });

  it("redacts email addresses", () => {
    const input = {
      email: "user@example.com",
      contact: "support@acme.org",
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.email).toContain("[REDACTED-EMAIL]");
    expect(result.contact).toContain("[REDACTED-EMAIL]");
  });

  it("redacts phone numbers", () => {
    const input = {
      phone: "(555) 123-4567",
      intlPhone: "+1-555-123-4567",
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.phone).toContain("[REDACTED-PHONE]");
    expect(result.intlPhone).toContain("[REDACTED-PHONE]");
  });

  it("fully redacts message fields", () => {
    const input = {
      message: "User debug: john@example.com and 001xx000003DGWI",
      debugString: "Customer name: John Smith, ID: 005xx0000012345AA",
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.message).toBe("[REDACTED]");
    expect(result.debugString).toBe("[REDACTED]");
  });

  it("preserves structural fields", () => {
    const input = {
      className: "MyApexClass",
      methodName: "processRecords",
      fieldName: "customField__c",
      sObjectType: "Account",
      count: 42,
      duration: 1250,
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.className).toBe("MyApexClass");
    expect(result.methodName).toBe("processRecords");
    expect(result.fieldName).toBe("customField__c");
    expect(result.sObjectType).toBe("Account");
    expect(result.count).toBe(42);
    expect(result.duration).toBe(1250);
  });

  it("deep-walks nested objects", () => {
    const input = {
      events: [
        {
          message: "Debug: user@example.com",
          className: "MyClass",
        },
        {
          message: "Error: ID 001xx000003DGWI not found",
          methodName: "findRecord",
        },
      ],
    };
    const result = redactReport(input) as Record<string, unknown>;
    const events = result.events as Array<Record<string, unknown>>;
    expect(events[0].message).toBe("[REDACTED]");
    expect(events[0].className).toBe("MyClass");
    expect(events[1].message).toBe("[REDACTED]");
    expect(events[1].methodName).toBe("findRecord");
  });

  it("respects redaction options", () => {
    const input = {
      email: "user@example.com",
      phone: "(555) 123-4567",
      recordId: "001xx000003DGWI",
    };

    // Only redact emails
    const result = redactReport(input, {
      email: true,
      sfId: false,
      phone: false,
    }) as Record<string, unknown>;
    expect(result.email).toContain("[REDACTED-EMAIL]");
    expect(result.phone).toBe("(555) 123-4567"); // Not redacted
    expect(result.recordId).toBe("001xx000003DGWI"); // Not redacted
  });

  it("handles null and undefined values", () => {
    const input = {
      nullValue: null,
      undefinedValue: undefined,
      normalString: "test@example.com",
    };
    const result = redactReport(input) as Record<string, unknown>;
    expect(result.nullValue).toBeNull();
    expect(result.undefinedValue).toBeUndefined();
    expect(result.normalString).toContain("[REDACTED-EMAIL]");
  });

  it("does not mutate original object", () => {
    const input = {
      email: "user@example.com",
      className: "MyClass",
    };
    const original = JSON.stringify(input);
    redactReport(input);
    expect(JSON.stringify(input)).toBe(original);
  });

  it("redacts sensitive descendants inside structural report sections", () => {
    const input = {
      database: {
        namedCredentials: [
          {
            credentialId: "0XA000000000001AAA",
            credentialName: "Production_ERP",
            endpoint:
              "https://user:password@api.example.com/orders?account=001xx000003DGWI&email=user@example.com",
            evidence: {
              raw: "NAMED_CREDENTIAL_REQUEST|Http Header Authorization=Bearer top-secret|Endpoint=https://api.example.com",
            },
          },
        ],
      },
    };

    const result = redactReport(input) as {
      database: {
        namedCredentials: Array<{
          credentialId: string;
          credentialName: string;
          endpoint: string;
          evidence: { raw: string };
        }>;
      };
    };
    const credential = result.database.namedCredentials[0];

    expect(credential.credentialId).toBe("[REDACTED-ID]");
    expect(credential.credentialName).toBe("[REDACTED]");
    expect(credential.endpoint).not.toContain("user:password");
    expect(credential.endpoint).not.toContain("001xx000003DGWI");
    expect(credential.endpoint).not.toContain("user@example.com");
    expect(credential.endpoint).toContain("account=%5BREDACTED%5D");
    expect(credential.evidence.raw).toBe("[REDACTED]");
    expect(credential.evidence.raw).not.toContain("top-secret");
  });

  it("does not leak repeated object references through cycle protection", () => {
    const shared = { email: "user@example.com" };
    const result = redactReport({ first: shared, second: shared }) as {
      first: { email: string };
      second: { email: string };
    };

    expect(result.first.email).toBe("[REDACTED-EMAIL]");
    expect(result.second.email).toBe("[REDACTED-EMAIL]");
    expect(result.second).toBe(result.first);
  });

  it("uses the strongest field policy for shared sensitive values", () => {
    const shared = { secret: "unpatterned customer secret" };
    const result = redactReport({ ordinary: shared, message: shared }) as {
      ordinary: { secret: string };
      message: { secret: string };
    };

    expect(result.ordinary.secret).toBe("unpatterned customer secret");
    expect(result.message.secret).toBe("[REDACTED]");
    expect(result.message).not.toBe(result.ordinary);
  });

  it("redacts deeply nested values without using the call stack", () => {
    const input: Record<string, unknown> = {};
    let inputCursor = input;
    for (let depth = 0; depth < 12_000; depth += 1) {
      const next: Record<string, unknown> = {};
      inputCursor.next = next;
      inputCursor = next;
    }
    inputCursor.message = "deep unpatterned secret";

    const result = redactReport(input) as Record<string, unknown>;
    let resultCursor = result;
    for (let depth = 0; depth < 12_000; depth += 1) {
      resultCursor = resultCursor.next as Record<string, unknown>;
    }
    expect(resultCursor.message).toBe("[REDACTED]");
  });

  it("turns circular references into serializable null boundaries", () => {
    const input: Record<string, unknown> = {};
    input.self = input;

    const result = redactReport(input) as Record<string, unknown>;

    expect(result.self).toBeNull();
    expect(JSON.stringify(result)).toBe('{"self":null}');
  });

  it("retains prototype-named JSON keys as redacted own properties", () => {
    const input = JSON.parse(`{
      "__proto__": {"email": "user@example.com"},
      "constructor": "001xx000003DGWI",
      "message": {"__proto__": "unpatterned secret"}
    }`) as Record<string, unknown>;

    const result = redactReport(input) as Record<string, unknown>;
    const prototypeValue = result.__proto__ as Record<string, unknown>;
    const message = result.message as Record<string, unknown>;

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(prototypeValue.email).toBe("[REDACTED-EMAIL]");
    expect(result.constructor).toBe("[REDACTED-ID]");
    expect(Object.hasOwn(message, "__proto__")).toBe(true);
    expect(message.__proto__).toBe("[REDACTED]");
    expect(JSON.parse(JSON.stringify(result))).toEqual(
      JSON.parse(`{
        "__proto__": {"email": "[REDACTED-EMAIL]"},
        "constructor": "[REDACTED-ID]",
        "message": {"__proto__": "[REDACTED]"}
      }`),
    );
  });

  it("redacts variable and record values without discarding numeric metrics", () => {
    const input = {
      executionPhases: [
        {
          variables: [
            {
              variableName: "accountName",
              rawValue: "Acme Strategic Acquisition",
              parsedValue: {
                Name: "Acme Strategic Acquisition",
                AnnualRevenue: 1250000,
                Contacts: ["Alice Example", "Bob Example"],
              },
            },
          ],
        },
      ],
      recordGraph: [
        {
          fields: [
            { field: "Secret_Code__c", value: "launch-at-dawn" },
            { field: "Employee_Count__c", value: 42 },
          ],
        },
      ],
    };

    const result = redactReport(input) as typeof input;
    const assignment = result.executionPhases[0].variables[0];
    const fields = result.recordGraph[0].fields;

    expect(assignment.variableName).toBe("accountName");
    expect(assignment.rawValue).toBe("[REDACTED]");
    expect(assignment.parsedValue).toEqual({
      Name: "[REDACTED]",
      AnnualRevenue: 1250000,
      Contacts: ["[REDACTED]", "[REDACTED]"],
    });
    expect(fields[0]).toEqual({
      field: "Secret_Code__c",
      value: "[REDACTED]",
    });
    expect(fields[1]?.value).toBe(42);
  });

  it("redacts query literals while preserving query structure and bind names", () => {
    const input = {
      database: {
        soql: [
          {
            query:
              "SELECT Id, Name FROM Account WHERE Name = 'Acme ''North''' AND OwnerId = :ownerId",
          },
        ],
        sosl: [{ query: "FIND {'private search'} IN ALL FIELDS" }],
      },
    };

    const result = redactReport(input) as typeof input;
    expect(result.database.soql[0].query).toBe(
      "SELECT Id, Name FROM Account WHERE Name = '[REDACTED]' AND OwnerId = :ownerId",
    );
    expect(result.database.sosl[0].query).toBe(
      "FIND {'[REDACTED]'} IN ALL FIELDS",
    );
  });

  it("fully masks raw evidence lines that can contain arbitrary values", () => {
    const input = {
      evidence: {
        raw: "VARIABLE_ASSIGNMENT|customerName|Unpatterned Customer Secret",
        rawLine: "12:00:00|USER_DEBUG|Unpatterned Customer Secret",
        logLine: "12:00:00|SOQL_EXECUTE_BEGIN|Name = 'Secret'",
        lineNumber: 12,
      },
    };

    const result = redactReport(input) as typeof input;
    expect(result.evidence).toEqual({
      raw: "[REDACTED]",
      rawLine: "[REDACTED]",
      logLine: "[REDACTED]",
      lineNumber: 12,
    });
  });

  it("masks structured callout content while retaining operation metadata", () => {
    const input = {
      database: {
        callouts: [
          {
            method: "POST",
            endpoint: "https://api.example.com/orders",
            statusCode: 201,
            text: "POST body: customer=Unpatterned Customer Secret",
            requestBody: '{"customer":"Unpatterned Customer Secret"}',
            responsePayload: { confirmation: "private-confirmation-code" },
            requestHeaders: {
              "Content-Type": "application/json",
              "X-Customer-Token": "private-token",
            },
          },
        ],
      },
    };

    const result = redactReport(input) as typeof input;
    const callout = result.database.callouts[0];
    expect(callout.method).toBe("POST");
    expect(callout.endpoint).toBe("https://api.example.com/orders");
    expect(callout.statusCode).toBe(201);
    expect(callout.text).toBe("[REDACTED]");
    expect(callout.requestBody).toBe("[REDACTED]");
    expect(callout.responsePayload).toEqual({
      confirmation: "[REDACTED]",
    });
    expect(callout.requestHeaders).toEqual({
      "Content-Type": "[REDACTED]",
      "X-Customer-Token": "[REDACTED]",
    });
  });

  it("still pattern-masks scalar structural metadata", () => {
    const input = {
      fileName: "user@example.com (001xx000003DGWI).log",
      filePath: "cases/user@example.com/001xx000003DGWI.log",
      className: "AccountProcessor",
      count: 5,
    };

    const result = redactReport(input) as typeof input;
    expect(result.fileName).toBe("[REDACTED-EMAIL] ([REDACTED-ID]).log");
    expect(result.filePath).toBe("cases/[REDACTED-EMAIL]/[REDACTED-ID].log");
    expect(result.className).toBe("AccountProcessor");
    expect(result.count).toBe(5);
  });

  it("masks every canonical and legacy raw-evidence alias", () => {
    const secret = "Unpatterned Customer Secret";
    const input = {
      cursor: {
        evidence: {
          raw: `CURSOR_CREATE_BEGIN|${secret}`,
          endRaw: `CURSOR_CREATE_END|${secret}`,
          lineNumber: 7,
          endLineNumber: 8,
        },
      },
      recursiveTrigger: {
        rawLogLineTexts: [`CODE_UNIT_STARTED|${secret}`],
      },
      parserDiagnostic: {
        samples: [`UNKNOWN_EVENT|${secret}`],
      },
      flattenedEvent: {
        rawLine: `USER_DEBUG|${secret}`,
        logLine: `USER_DEBUG|${secret}`,
        exitLogLine: `METHOD_EXIT|${secret}`,
        responseLogLine: `CALLOUT_RESPONSE|${secret}`,
      },
      legacyDebugEvent: {
        evidence: `USER_DEBUG|${secret}`,
        lineNumber: 9,
      },
    };

    const result = redactReport(input) as typeof input;
    expect(result.cursor.evidence).toEqual({
      raw: "[REDACTED]",
      endRaw: "[REDACTED]",
      lineNumber: 7,
      endLineNumber: 8,
    });
    expect(result.recursiveTrigger.rawLogLineTexts).toEqual(["[REDACTED]"]);
    expect(result.parserDiagnostic.samples).toEqual(["[REDACTED]"]);
    expect(result.flattenedEvent).toEqual({
      rawLine: "[REDACTED]",
      logLine: "[REDACTED]",
      exitLogLine: "[REDACTED]",
      responseLogLine: "[REDACTED]",
    });
    expect(result.legacyDebugEvent).toEqual({
      evidence: "[REDACTED]",
      lineNumber: 9,
    });
  });
});
