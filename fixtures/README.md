# Synthetic test logs

Every `.log` file in this directory is synthetic test data. The values use fabricated identifiers and reserved example domains; they are not production Salesforce logs.

When adding a fixture:

1. Keep only the lines required to demonstrate the behavior.
2. Use invented names and `example.com` endpoints.
3. Never copy credentials, tokens, production IDs, customer data, or internal domains.
4. Add a test that explains the expected parser or report behavior.
5. Run `pnpm validate`.

These files are intentionally exempted from the repository-wide `*.log` ignore rule so fresh clones and CI run the same integration tests.
