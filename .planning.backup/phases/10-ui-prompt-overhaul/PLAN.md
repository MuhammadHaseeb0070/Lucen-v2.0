# Phase 10: UI Prompt Overhaul & `<design_strategy>`

## Objective
Enhance `BASE_SYSTEM_PROMPT` in `src/config/prompts.ts` to enforce a strict `<design_strategy>` and specific Google Material/Apple premium aesthetic constraints, preventing the generic "AI signature" look. Also resolve fpdf2 Unicode and deprecation errors.

## Steps
1. Add `sanitize()` method to `ProfessionalDocument` python boilerplate.
2. Ban the use of `ln=True` in `fpdf2` logic.
3. Update `<design_intelligence>` to explicitly ban generic AI styles (purple gradients, heavy shadows) and require Material Design, Vercel, or Apple UI patterns.
4. Verify the frontend builds successfully after template literal updates.
