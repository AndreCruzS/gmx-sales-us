// Pure row→HubSpot-props mappers, fixture-tested with no network — same
// philosophy as src/lib/email and src/lib/calendar's pure cores. Every rule
// in the task-7 brief gets its own case here.

import { describe, expect, it } from "vitest";
import type { HubSpotOrgConfig } from "../port";
import {
  accountToCompanyProps,
  activityToEngagement,
  contactToContactProps,
  dealPropsToPatch,
  MappingError,
  nextActionToTaskProps,
  opportunityToDealProps,
  splitName,
  type AccountRow,
  type ActivityRow,
  type ContactRow,
  type NextActionRow,
  type OpportunityRow,
} from "../mapping";

const CFG: HubSpotOrgConfig = {
  pipeline_id: "pipeline-1",
  stage_map: {
    IDENTIFIED: "hs-stage-identified",
    QUALIFIED: "hs-stage-qualified",
    DEVELOPMENT: "hs-stage-development",
    QUOTE: "hs-stage-quote",
    DECISION: "hs-stage-decision",
    WON: "hs-stage-won",
    LOST: "hs-stage-lost",
    ON_HOLD: "hs-stage-on-hold",
  },
  owner_map: { "membership-1": "hs-owner-1" },
};

describe("splitName", () => {
  it("splits a two-word name into first/last", () => {
    expect(splitName("Deon Rep")).toEqual({ firstname: "Deon", lastname: "Rep" });
  });

  it("splits a multi-word name — first word firstname, rest lastname", () => {
    expect(splitName("Maria de la Cruz")).toEqual({
      firstname: "Maria",
      lastname: "de la Cruz",
    });
  });

  it("a single word name leaves lastname empty", () => {
    expect(splitName("Cher")).toEqual({ firstname: "Cher", lastname: "" });
  });
});

describe("accountToCompanyProps", () => {
  const account: AccountRow = {
    name: "Acme Distributing",
    city: "Miami",
    account_type: "DISTRIBUTOR",
    lead_source: "REFERRAL_DEALER",
    has_display_wall: true,
    owner_id: "membership-1",
  };

  it("maps name and city verbatim", () => {
    const props = accountToCompanyProps(account, {});
    expect(props.name).toBe("Acme Distributing");
    expect(props.city).toBe("Miami");
  });

  it("maps account_type and lead_source to the maximo custom properties", () => {
    const props = accountToCompanyProps(account, {});
    expect(props.maximo_account_type).toBe("DISTRIBUTOR");
    expect(props.maximo_lead_source).toBe("REFERRAL_DEALER");
  });

  it("maps has_display_wall true to the string 'true'", () => {
    const props = accountToCompanyProps(account, {});
    expect(props.maximo_display_wall).toBe("true");
  });

  it("maps has_display_wall false to the string 'false'", () => {
    const props = accountToCompanyProps({ ...account, has_display_wall: false }, {});
    expect(props.maximo_display_wall).toBe("false");
  });

  it("always marks maximo_managed as 'true'", () => {
    const props = accountToCompanyProps(account, {});
    expect(props.maximo_managed).toBe("true");
  });

  it("maps hubspot_owner_id from the ownerMap", () => {
    const props = accountToCompanyProps(account, { "membership-1": "hs-owner-1" });
    expect(props.hubspot_owner_id).toBe("hs-owner-1");
  });

  it("omits hubspot_owner_id (never empty string) when the membership is not in ownerMap", () => {
    const props = accountToCompanyProps(account, {});
    expect("hubspot_owner_id" in props).toBe(false);
  });
});

describe("contactToContactProps", () => {
  const contact: ContactRow = {
    name: "Joao Silva",
    email: "joao@example.com",
    phone: "+1 555-0100",
    job_title: "Purchasing Manager",
    is_champion: true,
  };

  it("splits name into firstname/lastname", () => {
    const props = contactToContactProps(contact, {});
    expect(props.firstname).toBe("Joao");
    expect(props.lastname).toBe("Silva");
  });

  it("leaves lastname empty for a single-word name", () => {
    const props = contactToContactProps({ ...contact, name: "Cher" }, {});
    expect(props.firstname).toBe("Cher");
    expect(props.lastname).toBe("");
  });

  it("maps email and phone verbatim", () => {
    const props = contactToContactProps(contact, {});
    expect(props.email).toBe("joao@example.com");
    expect(props.phone).toBe("+1 555-0100");
  });

  it("maps job_title to jobtitle", () => {
    const props = contactToContactProps(contact, {});
    expect(props.jobtitle).toBe("Purchasing Manager");
  });

  it("maps is_champion to the maximo custom property as a string", () => {
    expect(contactToContactProps(contact, {}).maximo_is_champion).toBe("true");
    expect(
      contactToContactProps({ ...contact, is_champion: false }, {}).maximo_is_champion,
    ).toBe("false");
  });

  it("always marks maximo_managed as 'true'", () => {
    expect(contactToContactProps(contact, {}).maximo_managed).toBe("true");
  });
});

describe("opportunityToDealProps", () => {
  const opp: OpportunityRow = {
    name: "Acme — Q3 flooring",
    stage: "QUALIFIED",
    estimated_revenue: 42000,
    expected_close_date: "2026-09-15",
    current_status: "Awaiting sample approval",
    current_blocker: "Budget sign-off pending",
    lead_source: "JOBSITE",
  };

  it("maps dealname from name", () => {
    expect(opportunityToDealProps(opp, CFG).dealname).toBe("Acme — Q3 flooring");
  });

  it("maps pipeline from cfg.pipeline_id", () => {
    expect(opportunityToDealProps(opp, CFG).pipeline).toBe("pipeline-1");
  });

  it("maps dealstage via cfg.stage_map", () => {
    expect(opportunityToDealProps(opp, CFG).dealstage).toBe("hs-stage-qualified");
  });

  it("throws MappingError for a stage absent from cfg.stage_map", () => {
    const badCfg: HubSpotOrgConfig = { ...CFG, stage_map: {} };
    expect(() => opportunityToDealProps(opp, badCfg)).toThrow(MappingError);
  });

  it("maps amount to String(estimated_revenue)", () => {
    expect(opportunityToDealProps(opp, CFG).amount).toBe("42000");
  });

  it("maps amount to null when estimated_revenue is null", () => {
    expect(
      opportunityToDealProps({ ...opp, estimated_revenue: null }, CFG).amount,
    ).toBeNull();
  });

  it("maps closedate to a ms-epoch string at UTC midnight of expected_close_date", () => {
    const closedate = opportunityToDealProps(opp, CFG).closedate;
    expect(closedate).toBe(String(Date.UTC(2026, 8, 15)));
  });

  it("maps closedate to null when expected_close_date is null", () => {
    expect(
      opportunityToDealProps({ ...opp, expected_close_date: null }, CFG).closedate,
    ).toBeNull();
  });

  it("maps current_status and current_blocker to the maximo custom properties", () => {
    const props = opportunityToDealProps(opp, CFG);
    expect(props.maximo_current_status).toBe("Awaiting sample approval");
    expect(props.maximo_current_blocker).toBe("Budget sign-off pending");
  });

  it("maps lead_source to the maximo custom property", () => {
    expect(opportunityToDealProps(opp, CFG).maximo_lead_source).toBe("JOBSITE");
  });

  it("always marks maximo_managed as 'true'", () => {
    expect(opportunityToDealProps(opp, CFG).maximo_managed).toBe("true");
  });
});

describe("dealPropsToPatch", () => {
  it("round-trips opportunityToDealProps output for a fully-populated deal", () => {
    const opp: OpportunityRow = {
      name: "Acme — Q3 flooring",
      stage: "DECISION",
      estimated_revenue: 15000,
      expected_close_date: "2026-11-01",
      current_status: "Sample sent",
      current_blocker: "None",
      lead_source: "PK_CLASS",
    };
    const props = opportunityToDealProps(opp, CFG);
    const patch = dealPropsToPatch(props, CFG);
    expect(patch).toEqual({
      stage: "DECISION",
      name: "Acme — Q3 flooring",
      estimated_revenue: 15000,
      expected_close_date: "2026-11-01",
      current_status: "Sample sent",
      current_blocker: "None",
    });
  });

  it("throws MappingError for an unknown inbound dealstage", () => {
    expect(() =>
      dealPropsToPatch({ dealstage: "some-unmapped-hs-stage-id" }, CFG),
    ).toThrow(MappingError);
  });

  it("includes only the keys present in props", () => {
    const patch = dealPropsToPatch({ dealname: "Renamed deal" }, CFG);
    expect(patch).toEqual({ name: "Renamed deal" });
  });

  it("maps a null amount to estimated_revenue: null", () => {
    const patch = dealPropsToPatch({ amount: null }, CFG);
    expect(patch).toEqual({ estimated_revenue: null });
  });

  it("maps a null closedate to expected_close_date: null", () => {
    const patch = dealPropsToPatch({ closedate: null }, CFG);
    expect(patch).toEqual({ expected_close_date: null });
  });
});

describe("activityToEngagement", () => {
  const base: ActivityRow = {
    activity_type: "DEALER_VISIT",
    occurred_at: "2026-08-01T14:30:00.000Z",
    purpose: null,
    objective: null,
    what_happened: null,
    outcomes: [],
  };

  const meetingTypes = [
    "DEALER_VISIT",
    "DISTRIBUTOR_VISIT",
    "CONTRACTOR_MEETING",
    "ARCHITECT_MEETING",
    "JOBSITE_VISIT",
    "PK_TRAINING",
  ] as const;

  for (const activity_type of meetingTypes) {
    it(`routes ${activity_type} to meetings`, () => {
      const result = activityToEngagement({ ...base, activity_type });
      expect(result.type).toBe("meetings");
      expect(result.props.hs_timestamp).toBe("2026-08-01T14:30:00.000Z");
      expect(typeof result.props.hs_meeting_title).toBe("string");
      expect("hs_meeting_body" in result.props).toBe(true);
    });
  }

  it("routes PHONE_CALL to calls", () => {
    const result = activityToEngagement({ ...base, activity_type: "PHONE_CALL" });
    expect(result.type).toBe("calls");
    expect(typeof result.props.hs_call_title).toBe("string");
    expect("hs_call_body" in result.props).toBe(true);
    expect(result.props.hs_timestamp).toBe("2026-08-01T14:30:00.000Z");
  });

  for (const activity_type of ["QUOTE_FOLLOWUP", "SAMPLE_FOLLOWUP", "EMAIL", "OTHER"] as const) {
    it(`routes ${activity_type} to notes`, () => {
      const result = activityToEngagement({ ...base, activity_type });
      expect(result.type).toBe("notes");
      expect("hs_note_body" in result.props).toBe(true);
      expect(result.props.hs_timestamp).toBe("2026-08-01T14:30:00.000Z");
    });
  }

  it("uses hs_timestamp = occurred_at ISO string as-is", () => {
    const result = activityToEngagement(base);
    expect(result.props.hs_timestamp).toBe(base.occurred_at);
  });

  it("composes the body from purpose, what_happened, and humanized outcomes, newline-joined", () => {
    const result = activityToEngagement({
      ...base,
      purpose: "Check on reorder",
      what_happened: "Discussed Q4 volume commitments.",
      outcomes: ["OPPORTUNITY_IDENTIFIED", "QUOTE_REQUESTED"],
    });
    expect(result.props.hs_meeting_body).toBe(
      "Check on reorder\nDiscussed Q4 volume commitments.\nOpportunity identified, Quote requested",
    );
  });

  it("falls back to the humanized objective when purpose is absent", () => {
    const result = activityToEngagement({
      ...base,
      purpose: null,
      objective: "MERCHANDISING_CHECK",
      what_happened: "Racks look good.",
    });
    expect(result.props.hs_meeting_body).toBe("Merchandising check\nRacks look good.");
  });

  it("skips empty parts when composing the body", () => {
    const result = activityToEngagement({ ...base, what_happened: "Just a quick stop." });
    expect(result.props.hs_meeting_body).toBe("Just a quick stop.");
  });

  it("produces an empty body when purpose, objective, what_happened, and outcomes are all absent", () => {
    const result = activityToEngagement(base);
    expect(result.props.hs_meeting_body).toBe("");
  });
});

describe("nextActionToTaskProps", () => {
  const action: NextActionRow = {
    action: "Follow up on sample request",
    due_date: "2026-08-10",
    completed_at: null,
    objective_detail: "Bring the new grout color chart.",
    owner_id: "membership-1",
  };

  it("maps action to hs_task_subject", () => {
    expect(nextActionToTaskProps(action, {}).hs_task_subject).toBe(
      "Follow up on sample request",
    );
  });

  it("maps due_date to a ms-epoch string at UTC midnight", () => {
    expect(nextActionToTaskProps(action, {}).hs_timestamp).toBe(
      String(Date.UTC(2026, 7, 10)),
    );
  });

  it("maps hs_task_status to NOT_STARTED when completed_at is null", () => {
    expect(nextActionToTaskProps(action, {}).hs_task_status).toBe("NOT_STARTED");
  });

  it("maps hs_task_status to COMPLETED when completed_at is set", () => {
    expect(
      nextActionToTaskProps({ ...action, completed_at: "2026-08-09T10:00:00.000Z" }, {})
        .hs_task_status,
    ).toBe("COMPLETED");
  });

  it("maps objective_detail to hs_task_body", () => {
    expect(nextActionToTaskProps(action, {}).hs_task_body).toBe(
      "Bring the new grout color chart.",
    );
  });

  it("maps hs_task_body to null when objective_detail is null", () => {
    expect(
      nextActionToTaskProps({ ...action, objective_detail: null }, {}).hs_task_body,
    ).toBeNull();
  });

  it("maps hubspot_owner_id from the ownerMap", () => {
    expect(
      nextActionToTaskProps(action, { "membership-1": "hs-owner-1" }).hubspot_owner_id,
    ).toBe("hs-owner-1");
  });

  it("omits hubspot_owner_id when the membership is not in ownerMap", () => {
    expect("hubspot_owner_id" in nextActionToTaskProps(action, {})).toBe(false);
  });
});
