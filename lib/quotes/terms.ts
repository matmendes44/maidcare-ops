import { company } from "../company";

// What the customer agrees to when accepting a quote online. The exact text
// shown is saved with each acceptance; change the version when the wording
// changes so old acceptances keep the words they agreed to. Have a lawyer
// review this wording for your business.
export const CONSENT_VERSION = "2026-10-2";

// The one statement they tick: shown next to the checkbox.
export const consentAgreement = () =>
  `I accept this estimate from ${company.legalName} at the prices shown, and I agree to sign and receive records electronically.`;

// The details behind it: shown under "What you're agreeing to".
export const consentDetails = () => [
  "Typing my name and selecting Accept is my electronic signature, the same as signing on paper.",
  `I can view, print or save this estimate and my acceptance from this page (any device that opens web pages works). For a free paper copy, call or text ${company.phone}.`,
  `I can withdraw my consent to electronic records the same way; that doesn't undo an acceptance already made.`,
  `Accepting doesn't book a time: ${company.shortName} will contact me to schedule. To cancel or reschedule a visit, call or text ${company.phone}.`,
];

// Everything they agreed to, as saved with the acceptance.
export const consentText = () => [consentAgreement(), ...consentDetails()];
