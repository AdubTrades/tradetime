# Prompt to paste into Claude

Put the whole `design-handoff` folder in the root of the project, then paste this:

---

I've added a `design-handoff/` folder with an approved redesign of the app's main screens. Please implement it.

1. Read `design-handoff/HANDOFF.md` fully first. It's the source of truth. `tokens.css` holds the design values, and `reference/*.html` shows the exact look of each screen. The reference files are annotated markup from a design tool, not code to paste.
2. Look at how this project is built (framework, styling approach, component library, routing, data layer) and tell me your plan before changing anything: where the tokens will live, which shared components you'll create or update, and the order you'll do the screens in.
3. After I approve the plan, start with the tokens and shared components, then do the screens one at a time in this order: Dashboard, Calendar, Time log, Journal, Playbook, Expenses.
4. Keep all existing functionality and real data. This is a restyle and re-layout, not a rewrite. Replace every placeholder listed under "Data to wire up" with real data or ask me about it.
5. After each screen, run the app, compare it against its reference file, fix any differences, then stop and let me check before moving to the next.
