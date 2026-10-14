import { describe, expect, it } from "vitest";
import { gate } from "../gate";

describe("the auth gate (Andre, 2026-10-14: Google sign-in sat on the page until a refresh)", () => {
  it("lets a signed-in person through to any page", () => {
    expect(gate({ pathname: "/contacts", signedIn: true, code: null })).toEqual({ kind: "pass" });
  });

  it("sends a stranger to the login page", () => {
    expect(gate({ pathname: "/", signedIn: false, code: null })).toEqual({
      kind: "redirect",
      pathname: "/login",
    });
    expect(gate({ pathname: "/contacts", signedIn: false, code: null })).toEqual({
      kind: "redirect",
      pathname: "/login",
    });
  });

  it("keeps a stranger on the login page", () => {
    expect(gate({ pathname: "/login", signedIn: false, code: null })).toEqual({ kind: "pass" });
  });

  it("sends a signed-in person away from the login page", () => {
    expect(gate({ pathname: "/login", signedIn: true, code: null })).toEqual({
      kind: "redirect",
      pathname: "/",
    });
  });

  it("a stranger coming back from Google with a code gets it exchanged, wherever it landed", () => {
    // Google hands the code to the site root; before this it was bounced to
    // /login?code=…, exchanged in the browser, and nobody moved off /login.
    expect(gate({ pathname: "/", signedIn: false, code: "abc" })).toEqual({ kind: "exchange" });
    expect(gate({ pathname: "/login", signedIn: false, code: "abc" })).toEqual({ kind: "exchange" });
  });

  it("a signed-in person with a code is the calendar Connect flow, which the browser finishes", () => {
    expect(gate({ pathname: "/settings/google", signedIn: true, code: "abc" })).toEqual({
      kind: "pass",
    });
  });
});
