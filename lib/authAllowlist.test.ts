import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_EMAILS,
  emailFromEntraProfile,
  isAllowedEmail,
} from "./authAllowlist";

test("every listed address is allowed", () => {
  for (const email of ALLOWED_EMAILS) {
    assert.equal(isAllowedEmail(email), true, email);
  }
});

test("the list is exactly the five approved accounts", () => {
  assert.equal(ALLOWED_EMAILS.length, 5);
});

test("comparison ignores case and surrounding whitespace", () => {
  assert.equal(isAllowedEmail("JFurda@CiderPressWoodworks.com"), true);
  assert.equal(isAllowedEmail("  rose@ciderpresswoodworks.com  "), true);
});

test("fails closed on missing or empty input", () => {
  assert.equal(isAllowedEmail(null), false);
  assert.equal(isAllowedEmail(undefined), false);
  assert.equal(isAllowedEmail(""), false);
  assert.equal(isAllowedEmail("   "), false);
});

test("near-miss addresses are rejected", () => {
  // Wrong TLD, wrong domain, lookalike local part, and a substring of a real one.
  assert.equal(isAllowedEmail("jfurda@ciderpresswoodworks.co"), false);
  assert.equal(isAllowedEmail("jfurda@ciderpress.com"), false);
  assert.equal(isAllowedEmail("jfurda@gmail.com"), false);
  assert.equal(isAllowedEmail("jfurda2@ciderpresswoodworks.com"), false);
  assert.equal(isAllowedEmail("rose@ciderpresswoodworks.com.evil.com"), false);
  assert.equal(isAllowedEmail("someoneelse@ciderpresswoodworks.com"), false);
});

test("email is read from whichever Entra claim carries it", () => {
  assert.equal(
    emailFromEntraProfile({ email: "karen@ciderpresswoodworks.com" }),
    "karen@ciderpresswoodworks.com"
  );
  // Entra often leaves `email` null and puts the address in preferred_username.
  assert.equal(
    emailFromEntraProfile({
      email: null,
      preferred_username: "susan@ciderpresswoodworks.com",
    }),
    "susan@ciderpresswoodworks.com"
  );
  assert.equal(
    emailFromEntraProfile({ upn: "chris@ciderpresswoodworks.com" }),
    "chris@ciderpresswoodworks.com"
  );
});

test("a profile with no usable claim yields an empty string, which is not allowed", () => {
  assert.equal(emailFromEntraProfile({}), "");
  assert.equal(emailFromEntraProfile(null), "");
  assert.equal(emailFromEntraProfile({ email: "  " }), "");
  assert.equal(isAllowedEmail(emailFromEntraProfile({})), false);
});
