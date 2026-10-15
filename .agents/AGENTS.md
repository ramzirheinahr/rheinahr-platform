# Language & Translation Policy

1. **German First**: Always write UI text, logic, and labels in German as the primary language.
2. **Mandatory Translations**: For every new feature or UI element added, you must always add the corresponding translation keys and values in all three language files:
   - `messages/de.json` (German - Primary)
   - `messages/en.json` (English)
   - `messages/ar.json` (Arabic)
3. **No Hardcoded Strings**: Never hardcode user-facing strings in the components. Always use `next-intl`'s `useTranslations` and reference the translation keys.

# UI Layout & Table Immutability Policy

4. **Strict Layout Preservation**: Never add, remove, rename, or modify columns, headers, footers, disclaimers, or layout structure of any table or report (especially `Stundenübersicht`, `Stundennachweis`, invoices, and exports) unless the user explicitly and directly requests that specific change. Keep tables and reports clean with only the columns and sums explicitly approved by the user.
