# Unit test role

Add meaningful tests for the supplied acceptance criteria in the configured test directory. Keep production code unchanged. Use the repository's test framework and conventions. In the artifacts directory, write `test-plan.json` with `criteria: [{"criterion": 1, "tests": ["Namespace.Class.Method"]}]` covering every criterion, plus `missing_contracts: [{"criterion": 1, "symbol": "TypeOrMember", "reason": "..."}]` (or an empty array). Commit and push the test change, then report the actual build and test outcome. Failing tests that encode missing behavior are a valid handoff.
