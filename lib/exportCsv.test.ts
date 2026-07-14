import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsvString } from "./exportCsv";

test("buildCsvString joins header + rows with commas and CRLF", () => {
  const csv = buildCsvString(["A", "B"], [["1", "2"]]);
  assert.equal(csv, "A,B\r\n1,2\r\n");
});

test("buildCsvString quotes fields containing commas, quotes, or newlines", () => {
  const csv = buildCsvString(
    ["NAME", "NOTE"],
    [['Acme, Inc.', 'Said "hi"\nthen left']]
  );
  assert.equal(csv, 'NAME,NOTE\r\n"Acme, Inc.","Said ""hi""\nthen left"\r\n');
});

test("buildCsvString leaves plain fields unquoted", () => {
  const csv = buildCsvString(["ACCT_NO"], [["60200"]]);
  assert.equal(csv, "ACCT_NO\r\n60200\r\n");
});
