"use client";

// THE ADDRESS STARTS AT THE ZIP (2026-09-15). Five digits resolve the town,
// the state and the region an account lands in, so it is created placed
// instead of arriving unplaced for somebody to fix later. City and state stay
// editable: the lookup is a convenience, and offline it simply does nothing.
//
// Shared by the full add-account form and the short "new company" form inside
// the quote and visit flows, so both place an account the same way.

import { useRef, useState } from "react";

export type ZipLookup =
  | { status: "idle" }
  | { status: "looking" }
  | { status: "found"; territoryId: string | null; territoryName: string | null; how: string }
  | { status: "failed"; message: string };

export function useZipLookup(profileTerritoryId: string | null) {
  const [zip, setZip] = useState("");
  const [city, setCityRaw] = useState("");
  const [state, setStateRaw] = useState("");
  const [lookup, setLookup] = useState<ZipLookup>({ status: "idle" });

  // Look the ZIP up the moment it is whole — from the keystroke that completes
  // it, not an effect watching it. Each lookup carries a sequence number so a
  // slow answer for an earlier ZIP can never overwrite the one now typed.
  const seqRef = useRef(0);
  function changeZip(raw: string) {
    const next = raw.replace(/\D/g, "").slice(0, 5);
    setZip(next);
    const seq = ++seqRef.current;
    if (next.length !== 5) {
      setLookup({ status: "idle" });
      return;
    }
    setLookup({ status: "looking" });
    fetch(`/api/zip/${next}`)
      .then(async (res) => {
        const body = await res.json();
        if (seq !== seqRef.current) return;
        if (!res.ok) {
          setLookup({ status: "failed", message: body.error ?? "Could not look that ZIP up." });
          return;
        }
        setCityRaw(body.city ?? "");
        setStateRaw(body.state ?? "");
        setLookup({
          status: "found",
          territoryId: body.territoryId ?? null,
          territoryName: body.territoryName ?? null,
          how: body.how,
        });
      })
      .catch(() => {
        if (seq === seqRef.current)
          setLookup({
            status: "failed",
            message: "No connection for the ZIP lookup. Type the city and state by hand.",
          });
      });
  }

  // Editing what the ZIP resolved to un-says the placement it implied.
  function setCity(v: string) {
    setCityRaw(v);
    if (lookup.status === "found") setLookup({ status: "idle" });
  }
  function setState(v: string) {
    setStateRaw(v.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase());
    if (lookup.status === "found") setLookup({ status: "idle" });
  }

  // Where the account lands: the address's own region when the lookup placed
  // it; otherwise the creator's territory (a rep adding a door in their own
  // patch); otherwise nowhere yet — an admin has no patch of their own.
  const territoryId =
    lookup.status === "found" && lookup.territoryId
      ? lookup.territoryId
      : profileTerritoryId;

  return { zip, changeZip, city, setCity, state, setState, lookup, territoryId };
}

/** The one line under the ZIP field saying what the lookup made of it. */
export function zipLookupNote(lookup: ZipLookup): { text: string; bad: boolean } | null {
  switch (lookup.status) {
    case "looking":
      return { text: "Looking that ZIP up…", bad: false };
    case "failed":
      return { text: lookup.message, bad: true };
    case "found":
      return {
        text: lookup.territoryName
          ? `Lands in ${lookup.territoryName}.`
          : lookup.how === "city-not-on-map"
            ? "California is placed city by city, and this city is not on the map yet — the account saves unplaced."
            : "No region covers this state yet — the account saves unplaced.",
        bad: false,
      };
    default:
      return null;
  }
}
