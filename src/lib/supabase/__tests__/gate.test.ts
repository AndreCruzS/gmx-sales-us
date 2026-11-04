import { describe, expect, it } from "vitest";
import { gate as rawGate, safeNext } from "../gate";

const gate = (r: { pathname: string; signedIn: boolean; code: string | null; search?: string }) =>
  rawGate({ search: "", ...r });

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

  it("a stranger at the consent page is sent to login carrying the way back", () => {
    expect(
      gate({ pathname: "/oauth/consent", search: "?authorization_id=abc", signedIn: false, code: null }),
    ).toEqual({ kind: "redirect", pathname: "/login", next: "/oauth/consent?authorization_id=abc" });
  });

  it("a stranger at an ordinary page gets no way back", () => {
    expect(gate({ pathname: "/visits", search: "?x=1", signedIn: false, code: null })).toEqual({
      kind: "redirect",
      pathname: "/login",
    });
  });

  it("a signed-in person on login with a consent next is sent there", () => {
    expect(
      gate({
        pathname: "/login",
        search: "?next=/oauth/consent?authorization_id=abc",
        signedIn: true,
        code: null,
      }),
    ).toEqual({ kind: "redirect", pathname: "/", next: "/oauth/consent?authorization_id=abc" });
  });

  it("a foreign next is ignored", () => {
    expect(
      gate({ pathname: "/login", search: "?next=https://evil.com", signedIn: true, code: null }),
    ).toEqual({ kind: "redirect", pathname: "/" });
  });
});

describe("safeNext", () => {
  it("allows only the consent page", () => {
    expect(safeNext("/oauth/consent?authorization_id=abc")).toBe("/oauth/consent?authorization_id=abc");
    expect(safeNext("/oauth/consent")).toBe("/oauth/consent");
    expect(safeNext(null)).toBeNull();
    expect(safeNext("/visits")).toBeNull();
    expect(safeNext("https://evil.com")).toBeNull();
    expect(safeNext("//evil.com/oauth/consent")).toBeNull();
    // A real backslash (in a JS literal "\\" is one character).
    expect("/oauth/consent\\..\\evil").toContain("\\");
    expect(safeNext("/oauth/consent\\..\\evil")).toBeNull();
    expect(safeNext("/oauth/consent?x=\\evil")).toBeNull();
    expect(safeNext("/oauth/consentx")).toBeNull();
  });
});
