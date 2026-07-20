---
name: telmi-story-illustrator
description: Create or regenerate coherent, text-free illustrations for interactive children's stories compiled for Telmi OS. Use for Telmi covers, narrative scenes, choice cards, or image variants that must preserve character identity, art direction, palette, child-safe content, and horizontal 4:3 composition across a complete story.
---

# Telmi Story Illustrator

Create one production image by composing the installed `$imagegen` skill. Treat the supplied prompt and reference image as the authoritative visual specification.

## Workflow

1. Read [references/visual-contract.md](references/visual-contract.md).
2. Extract from the request: asset role, story context, subject, action, setting, art style, continuity constraints, forbidden elements, reference path, and output path.
3. If a reference path is supplied, inspect that image before generation and use it as an identity-and-style reference. Preserve the character species, silhouette, face, colors, proportions, accessories, palette, medium, lighting, and detail level. Do not copy its scene composition unless requested.
4. Invoke `$imagegen` exactly once for the requested asset. Pass the normalized visual specification, the reference image when present, and the no-text constraints.
5. Check the result for the requested subject, continuity, child safety, 4:3 crop safety, and forbidden text-like marks. If a blocking defect is visible, retry once with a short correction targeting only that defect.
6. Save the selected bitmap at the exact requested output path. Return no prose beyond a short success or blocking-error statement.

## Generation rules

- Produce a horizontal illustration with important subjects inside the central 4:3 safe area; the application performs the deterministic final crop to 640 x 480.
- Never place any readable or pseudo-readable content: no words, letters, digits, title, logo, signature, watermark, signage, book text, labels, glyphs, runes, speech bubbles, or decorative marks resembling writing.
- Never infer that the child named in story metadata is a depicted human character. Depict only the explicitly described story characters.
- Preserve the requested graphical medium. Do not mix watercolor, vector, 3D, anime, photography, or other media unless the prompt explicitly requests it.
- Keep the scene visually simple, readable on a small Miyoo Mini Plus screen, and appropriate for the stated age.
- For a cover, create a representative scene without rendering the story title.
- For a choice, depict the visual consequence of that specific choice rather than generic paths, buttons, arrows, or UI.
- When the request identifies an image as one of several choices, reserve a quiet area in the bottom-left corner for the application's choice indicator. Do not place faces, hands, essential props, or narrative action there. The application adds a consistent white quarter-circle with left and right arrows after generation; do not draw that indicator yourself.
- For regeneration, preserve all elements not explicitly changed in the revised prompt.

## Tool boundary

Use `$imagegen` as the only image-generation layer. Do not call an image API, CLI fallback, drawing script, SVG generator, or local diffusion model. The application handles resizing, PNG encoding, storage, and accounting after the skill returns.
