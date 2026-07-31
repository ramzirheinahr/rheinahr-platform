# Language & Translation Policy

1. **German First**: Always write UI text, logic, and labels in German as the primary language.
2. **Mandatory Translations**: For every new feature or UI element added, you must always add the corresponding translation keys and values in all three language files:
   - `messages/de.json` (German - Primary)
   - `messages/en.json` (English)
   - `messages/ar.json` (Arabic)
3. **No Hardcoded Strings**: Never hardcode user-facing strings in the components. Always use `next-intl`'s `useTranslations` and reference the translation keys.
