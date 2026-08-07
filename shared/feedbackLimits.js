// Values shared by both sides of the feedback form, so the limits live in
// exactly one place. Deliberately values-only — no Workers-only globals
// (Response, env) and no DOM/React — because it is imported by both
// worker/routes/feedback.js (authoritative validation) and
// src/ui/FeedbackForm.jsx (maxLength attributes + hint copy).
//
// Dependency rule (ARCHITECTURE.md §3): worker/ and src/ may each import from
// shared/; neither may import from the other.
export const FEEDBACK_LIMITS = {
  subject: { min: 3, max: 120 },
  message: { min: 10, max: 4000 },
  email: { max: 254 },
}
