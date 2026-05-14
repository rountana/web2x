# 📄 Prompt: Convert Raw PDF Text into Structured, Well-Formatted Document

You are given raw text extracted from a PDF. The text may be poorly formatted due to loss of layout information (e.g., broken lines, missing hierarchy, misplaced spacing, inconsistent bullets).

Your task is to reconstruct the document into a clean, structured, and human-readable format.

---

## 🎯 Objectives

1. **Rebuild Document Structure**
   - Identify and organize:
     - Name / Header
     - Summary
     - Sections (e.g., EXPERIENCE, EDUCATION, SKILLS, etc.)
     - Subsections (roles, companies, dates)
     - Bullet points

2. **Detect Sections**
   - Treat short ALL-CAPS phrases as section headers (e.g., EXPERIENCE, SKILLS)
   - Group content under the appropriate section

3. **Identify Roles / Entries**
   - Detect job titles, companies, and date ranges
   - Associate bullet points with the correct role

4. **Handle Bullet Points**
   - Normalize bullets (e.g., ●, •, - → `-`)
   - Ensure each bullet is a complete sentence

5. **Fix Broken Text**
   - Merge fragmented lines into coherent sentences
   - Correct spacing and formatting issues

6. **Preserve Meaning**
   - Do NOT remove important information
   - Lightly clean grammar if needed, but do not rewrite content

---

## 📦 Output Format

Produce clean Markdown with clear hierarchy:

- `#` for name/title
- `##` for sections
- `###` for roles or subsections
- `-` for bullet points

---

## 🧾 Example Output Structure

```md
# Full Name

## Summary
Brief professional summary...

## Experience

### Role – Company (Dates)
- Bullet point
- Bullet point

## Education
...

## Skills
...