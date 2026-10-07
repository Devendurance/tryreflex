# Design System Inspired by Market Desk
### (① Bento grid × ② Spotlight feature grid × ③ Hero × ④ Post-hero cards & buttons, one locked type stack)

**Sourcing key — each reference owns a job, nothing else:**
- ① Colorful bento grid → the output/resources section
- ② Feature-grid spotlight cards → the features section
- ③ Hero reference (isometric line-art on warm cream) → nav, hero layout, illustration language
- ④ Post-hero section reference → card arrangement and styling in the section after the hero, plus all button styles

**What makes them one system:** the references share a warm paper ground, one orange accent and soft rounded geometry. This doc makes those three things global, then limits each reference's signature (tilted cards, hairline grid, pastel tiles) to its own section so they never compete.

**Not adopted:** ④'s black sections, italic headline and photography. ④ is used for card arrangement, card styling and buttons only.

**Name:** "Market Desk" is a placeholder. Rename the file and title when you have the product name.

## 1. Visual Theme & Atmosphere

A research desk in warm daylight: paper-colored ground, ink-brown type, and one small machine doing the work. The voice is editorial (a serif headline, like a published desk note). The interface is quiet and friendly (rounded pills, soft tiles). The data is exact (labeled, tabular, color-coded gain and loss). Illustration is always isometric line-art, never photography, so the product reads as an instrument rather than a magazine.

**Key Characteristics**
- Warm cream-to-white hero gradient; warm paper sections below; white raised surfaces ①②③④
- Three typefaces with strict ownership: serif speaks, Satoshi operates, Georama labels and measures
- Orange is rationed: one filled orange element per viewport (the primary action), plus at most two small accents
- Four card languages, one per section, each shown only in its own section: tilted white cards ④, hairline spotlight cells ②, flat pastel tiles ①, line-art hero ③
- One illustration style everywhere: isometric, 1.5px ink line, dashed "ghost" offset contour, a single orange object
- Warm neutrals throughout; no cool grays
- Calm composition: asymmetric hero, centered section headers, left-aligned card content

## 2. Color Palette & Roles

### Grounds & Surfaces
- **Cream** (`#FBF5EC`): hero mid-tone, quiet pills ③
- **Hero Top** (`#F6EADC`): top of the hero gradient ③
- **Paper** (`#F4EFE6`): section ground for features and bento ②①
- **White** (`#FFFFFF`): raised cards, bento outer container, bottom of the hero gradient ①④
- **Stone** (`#E9E4DA`): neutral tile, "coming soon" tile ①

Hero gradient: `linear-gradient(180deg, #F6EADC 0%, #FBF5EC 55%, #FFFFFF 100%)`.

### Ink & Neutrals
- **Ink** (`#241B15`): headlines, body emphasis, borders on ink pills, button text
- **Muted** (`#6B625A`): body, subheads, captions (5.1:1 on Paper)
- **Hairline** (`#DDD6C8`): grid lines, outlines, dividers ②
- **Crosshair** (`#8A8277`): "+" grid markers ②

### Accents
- **Signal Orange** (`#F26B1D`): primary button, one illustration object, one card edge ③④
- **Orange Hover** (`#E8600F`), **Orange Tint** (`rgba(242,107,29,.12)`)
- **Signal Blue** (`#3F5BD8`): alternate card edge and its icon tint only ④
- **Blue Tint** (`rgba(63,91,216,.12)`)

### Bento Pastels (bento section only) ①
- **Sage** `#DCE7DC` · **Lavender** `#E0DDF3` · **Butter** `#F9F0C8` · **Blush** `#F4D5D9` · **Stone** `#E9E4DA`

Butter and Blush are deepened slightly from the reference so they hold against Paper.

### Semantic (market data)
- **Gain** (`#3F7A5B`): positive values, stat lines ①
- **Loss** (`#B8404E`): negative values
- Never use orange for gain or loss.

**Contrast rules:** Ink text goes on orange (white on `#F26B1D` fails AA at body size). Orange is never text under 24px.

## 3. Typography Rules

### Font Family (locked)
**Editorial Serif — Newsreader** (Google Fonts, variable, optical size 6–72): the voice. My pick for a market-desk research product: newspaper credibility, a real display optical size, lining figures. Swap candidates if needed: Source Serif 4, Libre Caslon Text. Any swap must keep a display cut and weights 400–500.
Fallback: 'Source Serif 4', Georgia, serif

**Interface — Satoshi** (Fontshare, free for commercial use; prefer self-hosting): navigation, buttons, card titles, all reading text. Use weights 400, 500, 700 only (there is no 600).
Fallback: 'General Sans', -apple-system, 'Segoe UI', sans-serif

**Labels & Data — Georama** (Google Fonts, variable weight and width): eyebrows, bento tile labels, captions, stats, timestamps, tickers. Keep `wdth` at 100–110.
Fallback: 'Satoshi', system-ui, sans-serif

### Role Ownership
| Family | Owns | Never |
|--------|------|-------|
| Newsreader | Hero H1, section H2, brief headlines (≥24px) | UI, buttons, labels, anything under 24px |
| Satoshi | Nav, buttons, subheads, card titles, body | Headlines, data, eyebrows |
| Georama | Eyebrow pills, tile labels, captions, stats, tickers | Paragraphs, headlines, buttons |

### Hierarchy (desktop)

| Rank | Role | Font | Size / Line | Weight | Tracking | Color |
|------|------|------|-------------|--------|----------|-------|
| 1 | Display (hero H1) | Newsreader | 72 / 76 | 500 | -0.02em | Ink |
| 2 | Section Headline (H2) | Newsreader | 48 / 54 | 500 | -0.015em | Ink |
| 3 | Brief Headline | Newsreader | 24 / 30 | 500 | -0.01em | Ink |
| 4 | Lead (subhead) | Satoshi | 18 / 30 | 400 | 0 | Muted |
| 5 | Card Title | Satoshi | 20 / 28 | 500 | 0 | Ink |
| 6 | Body | Satoshi | 16 / 26 | 400 | 0 | Muted |
| 7 | Small | Satoshi | 14 / 22 | 400 | 0 | Muted |
| 8 | Button | Satoshi | 15 / 20 | 700 | 0 | Ink |
| 9 | Nav | Satoshi | 14 / 20 | 500 | 0 | Ink |
| 10 | Eyebrow | Georama | 12 / 16 | 700 | +0.14em, caps | `#5A5348` |
| 11 | Tile Label | Georama | 22 / 26 | 700 | -0.01em | Cream on Ink pill |
| 12 | Tile Caption | Georama | 14 / 18 | 400 | 0 | Ink at 80% |
| 13 | Data | Georama | 15 / 20 | 600, tabular | 0 | Gain / Loss / Ink |
| 14 | Stat Figure | Georama | 40 / 44 | 700, tabular | -0.01em | Ink |

### Principles
- One serif headline per section. Subheads are always Satoshi.
- Emphasis comes from size, weight and color role, never italics and never one accented word in a headline. Headlines are all Ink.
- Never put two families in one line. A Georama label stacks above Satoshi text, it does not sit inline.
- Georama is capped at 22px except stat figures (40px).
- Check x-height beside Satoshi. If Georama reads larger at the same size, set it 1px smaller.
- Body lines stay under 65 characters; leads under 62ch.
- Use `font-optical-sizing: auto` on Newsreader and `font-variant-numeric: tabular-nums` on all data.

## 4. Component Stylings

### Buttons ④ (all pills, no shadows)

**Primary**
- **Background:** `#F26B1D` · **Text:** `#241B15` · **Radius:** `9999px`
- **Padding:** `0 28px` · **Height:** `48px` · **Font:** Satoshi 700, 15px
- **Hover:** `#E8600F` · **Active:** `#CF540B`, `scale(.98)`

**Secondary**
- **Background:** transparent · **Border:** `1.5px solid #F26B1D` · **Text:** `#241B15`
- Same size as Primary · **Hover:** fill `rgba(242,107,29,.12)`

**Quiet** ③
- **Background:** `#EFE5D6` · **Text:** `#241B15` · **No border**
- Same size as Primary, or `40px` high with `0 20px` padding in the nav
- **Hover:** `#E8DAC7`

**Rules:** Disabled is 45% opacity. Focus is `2px solid #241B15` with a `3px` offset. Hero pairs Primary with Quiet. The capabilities and closing sections pair Primary with Secondary.

### Navigation ③
- **Background:** `rgba(246,234,220,.8)` with `backdrop-filter: blur(12px)`
- **Height:** `56px` · **Bottom edge:** `1px solid #DDD6C8`
- **Layout:** left links (Satoshi 500, 14px, with chevrons on menus), centered wordmark slot, right text link plus Quiet pill (small)
- **Mobile:** wordmark left, menu button right (`44px`)

### Section Header (shared by every section)
- Centered. Optional **Eyebrow Pill**: `1px solid #DDD6C8`, fill `#F8F5EE`, padding `6px 16px`, Georama 12px caps, once per section, never in the hero.
- Then a Newsreader H2 and a Satoshi lead, `16px` between each, `64px` below the block.
- **Split variant (bento only):** H2 left, lead right (max `380px`, Satoshi 500, 16px).

### Hero ③
- **Layout:** 12-column; text in columns 1–5, vertically centered; illustration in columns 6–12 bleeding off the right and bottom edges
- **Content:** Display H1 (two lines max), Lead (max `40ch`), Primary + Quiet buttons `24px` apart
- **Ground:** the hero gradient from Section 2
- **Illustration:** a diagonal white band (`64px`, dashed edges) running top-left to bottom-right, carrying tiles toward a bolted central unit, with output tiles leaving on the far side. For this product: source tiles (filings, feeds, notes) in, brief cards out, one orange chip as the only color.

### Cards & Containers

**Capability Card** ④ (section after the hero)
- **Background:** `#FFFFFF` · **Radius:** `12px` · **Padding:** `24px`
- **Edge:** `3px solid` Signal Orange or Signal Blue on the left, alternating
- **Icon:** `32px` tinted square (Orange or Blue Tint), radius `4px`
- **Title:** Satoshi 20/500 · **Body:** Satoshi 14/22 Muted
- **Shadow:** Float (Section 6) · **Width:** `300–340px`
- **Rotation:** left column `-6°` to `-3°`, right column `+3°` to `+5°`; never more than 6°
- **Arrangement:** 2×2 stagger around a center ghost illustration. Right-column cards sit 40px lower than left-column cards on the top row and 30px higher on the bottom row.
- **Center ghost:** the hero's machine, `360px`, Ink lines at 8% opacity

**Spotlight Cell** ② (features section)
- **Grid:** 3 columns, no gaps; cells share `1px #DDD6C8` lines
- **Markers:** `12px` "+" in Crosshair at each cell's top-left and bottom-right corners
- **Spotlight:** `radial-gradient(ellipse 60% 55% at 20% 0%, #E5DFD1, transparent 70%)`
- **Padding:** `32px` · **Min height:** `260px`
- **Icon tile:** `48px`, `1px solid #E2DDD2`, fill `#F7F4EC`, radius `4px`, icon `24px` at `1.5px` Ink stroke
- **Title:** Satoshi 20/500 · **Body:** Satoshi 16/26 Muted
- **No shadow, no radius**

**Bento Tile** ① (output / resources section)
- **Container:** White, radius `28px`, padding `20px`, sits on Paper
- **Grid:** 12 columns, `20px` gap. Row 1: one 8-column tile and one 4-column tile. Row 2: three 4-column tiles. Row height `360px`.
- **Tile:** flat pastel from Section 2, radius `12px`, no border, no shadow
- **Tile Label:** Ink pill, Georama 22/700 in Cream, padding `10px 24px`, rotated `-3°` to `+4°` (vary tile to tile), with a Tile Caption `8px` above, offset `8px` left
- **Anchors:** top-center, center, or left-center. Pick one per tile so labels don't line up in a row.
- **"Coming soon" variant:** Stone or Blush tile with a White pill at 80% and Ink text
- **Art slot (optional):** hero-style line illustration, bottom-aligned, tile color lightened 40% for fills
- **Stat line** under the container headline: Georama 15/600 in Gain

### Illustration & Imagery (applies to every section)
- Isometric at 30°, `1.5px` Ink line, rounded joins
- Fills from Paper, Cream and White only; exactly one object per illustration in Signal Orange
- Dashed ghost contour offset `6–8px` (`dash 3 4`, Ink at 30%) is the illustration's only shadow
- No gradients, no photographs, no stock people
- Product screenshots go in a White frame, radius `12px`, `1px` Hairline, flat

### Inputs & Forms (extrapolated; none shown in the references)
- **Query Input:** `56px` high, radius `12px`, `1px solid #DDD6C8`, fill White, padding `0 20px`, Satoshi 16
- **Focus:** border Ink plus `0 0 0 4px rgba(242,107,29,.18)`
- **Label:** Satoshi 14/500 Ink · **Helper:** Satoshi 13 Muted
- **Placeholder:** `rgba(36,27,21,.45)`

## 5. Layout Principles

### Spacing System
**Base Unit:** `4px`
**Scale:** `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 120`

**Spacing Contract (use only these):**

| Relationship | Value |
|--------------|-------|
| Eyebrow → H2 | 16 |
| H2 → Lead | 16 |
| Section header → content | 64 |
| Icon tile → card title | 24 |
| Card title → body | 8 |
| Card grid gap (bento, capability) | 20 |
| Card padding | 24 (capability), 32 (spotlight), 20 (bento container) |
| Section padding, top and bottom | 120 desktop · 80 tablet · 64 mobile |
| Button gap | 12 (nav) · 24 (hero) |

### Grid & Container
- **Max width:** `1280px`, centered · **Side padding:** `32px` desktop, `20px` mobile
- **Columns:** 12, `20px` gutter
- **Alignment:** hero text left-aligned; section headers centered (bento may split); all card content left-aligned

### Page Blueprint

| Order | Section | Ground | Language |
|-------|---------|--------|----------|
| 1 | Nav | translucent Hero Top | ③ |
| 2 | Hero | hero gradient | ③ + ④ buttons |
| 3 | Capabilities | White | ④ tilted cards |
| 4 | Features | Paper | ② spotlight grid |
| 5 | Output / Resources | Paper with a White container | ① bento |
| 6 | Closing CTA (optional) | Cream | serif H2 + Primary + Secondary |

Grounds alternate White → Paper → Paper without hard rules. A color change is the divider.

### Whitespace Philosophy
Generous around headlines and the hero illustration; tight inside grids. Every section has exactly one focal point, so nothing competes: the machine in the hero, the center ghost in capabilities, the grid in features, the tile labels in bento.

### Border Radius Scale
- `4px` icon tiles
- `12px` tiles, capability cards, inputs, screenshot frames
- `28px` bento container
- `9999px` buttons, pills, eyebrow, tile labels

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| 0 Flat | none | bento tiles, spotlight cells, body |
| 1 Hairline | `1px #DDD6C8` | spotlight grid, nav edge, eyebrow, inputs |
| 2 Float | `0 12px 32px rgba(36,27,21,.10), 0 2px 6px rgba(36,27,21,.06)` | capability cards only |
| Light | radial warm glow at a cell's top-left | spotlight cells (light, not elevation) |
| Ghost | dashed offset contour | illustrations only |

**Philosophy:** Only the tilted capability cards float. Everything else is flat color or a hairline. Buttons never have shadows; they change fill.

## 7. Do's and Don'ts

### Do
- Assign each reference's signature to its own section only
- Set every headline in Newsreader at 24px or larger
- Keep orange to one filled element per viewport plus at most two small accents
- Alternate capability-card edges orange / blue
- Keep tilt at or below 6° and vary it card to card
- Use warm-gray neutrals (`#6B625A`, `#8A8277`, `#DDD6C8`) everywhere
- Put one orange object in each illustration and no more
- Use Gain and Loss tokens for all market data

### Don't
- Don't set headlines in Satoshi or Georama, or labels in Newsreader
- Don't italicize headlines or color a single word
- Don't mix card languages inside one section (no pastel tiles beside tilted cards)
- Don't put shadows on bento tiles, spotlight cells or buttons
- Don't use cool grays (`#6B7280` and similar)
- Don't use orange text under 24px or white text on orange
- Don't use orange for gain, loss or any data meaning
- Don't add dark sections, photography or italic display type from ④

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <640px | Hero stacks, illustration below text at ~70vw tall, bleeding off the right. Capability cards stack in one column, tilt 0°, left edge kept, center ghost hidden. Spotlight grid is 1 column with hairlines kept. Bento is 1 column, wide tile first, row height auto (min 220px). |
| Tablet | 640–1023px | Hero stacks. Capability cards 2×2, tilt ±2°. Spotlight 2 columns. Bento 2 columns, wide tile spans both. |
| Desktop | 1024–1439px | Full layouts as specified. |
| Wide | ≥1440px | Container stays 1280px; grounds extend to the edges. |

### Type by Breakpoint
| Role | Mobile | Tablet | Desktop |
|------|--------|--------|---------|
| Display | 40 / 44 | 56 / 60 | 72 / 76 |
| Section Headline | 32 / 38 | 40 / 46 | 48 / 54 |
| Lead | 16 / 26 | 17 / 28 | 18 / 30 |
| Tile Label | 18 / 22 | 20 / 24 | 22 / 26 |

### Touch Targets
- **Minimum:** `44 × 44px`; buttons are `48px`
- **Spacing between targets:** `8px` minimum
- Respect `prefers-reduced-motion`: no tilt animation, no entrance motion

## 9. Agent Prompt Guide

### Quick Color Reference
- **Grounds:** Cream `#FBF5EC` · Hero Top `#F6EADC` · Paper `#F4EFE6` · White `#FFFFFF`
- **Type:** Ink `#241B15` · Muted `#6B625A` · Hairline `#DDD6C8`
- **Accents:** Orange `#F26B1D` · Blue `#3F5BD8`
- **Pastels (bento only):** `#DCE7DC` `#E0DDF3` `#F9F0C8` `#F4D5D9` `#E9E4DA`
- **Data:** Gain `#3F7A5B` · Loss `#B8404E`

### Token Starter
```css
:root{
  --font-serif:'Newsreader','Source Serif 4',Georgia,serif;
  --font-ui:'Satoshi','General Sans',-apple-system,'Segoe UI',sans-serif;
  --font-data:'Georama','Satoshi',system-ui,sans-serif;
  --ink:#241B15; --muted:#6B625A; --hairline:#DDD6C8;
  --paper:#F4EFE6; --cream:#FBF5EC; --white:#FFFFFF;
  --orange:#F26B1D; --orange-hover:#E8600F; --blue:#3F5BD8;
  --gain:#3F7A5B; --loss:#B8404E;
  --r-icon:4px; --r-card:12px; --r-container:28px; --r-pill:9999px;
  --gap:20px; --section-y:120px;
}
```
Satoshi loads from Fontshare (`https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap`), Newsreader and Georama from Google Fonts.

### Build Order
1. Load the three fonts, add the token block, set body to Satoshi 16/26 Muted on Paper.
2. Build the type ladder as utility classes from the hierarchy table.
3. Build the three buttons, the eyebrow pill and the section header.
4. Build the nav, then the hero with its illustration.
5. Build the Capabilities section with Capability Cards and the center ghost.
6. Build the Features section: hairline grid, crosshairs and spotlight glow.
7. Build the Bento section: container, tiles, tilted labels, stat line.
8. Run the contrast, spacing-contract and one-orange-per-viewport checks, then the breakpoints.

### Iteration Guide
1. **Role ownership is the first rule.** Serif for headlines, Satoshi for interface and reading, Georama for labels and data. If you are unsure, check the Role Ownership table.
2. **Headlines are all Ink, all Newsreader, never italic.**
3. **One filled orange element per viewport.** Orange text stays at 24px or above, and Ink text goes on orange.
4. **Tilted cards live only in the section after the hero; hairline grids only in features; pastel tiles only in bento.**
5. **Only capability cards cast a shadow.** Everything else is flat or hairline.
6. **Warm neutrals only.** Replace any cool gray with the Muted or Hairline token.
7. **Illustrations follow the Imagery rules:** isometric, 1.5px Ink, dashed ghost, one orange object, no photos.
8. **Use the Spacing Contract values and nothing else for gaps and paddings.**
9. **Alternate capability-card edges orange / blue** and keep tilt at 6° or less.
10. **Market numbers use Georama tabular figures with Gain and Loss colors**, never orange.
11. **Section headers are centered with an optional eyebrow;** only bento splits the header.
12. **Every pill is `9999px`; every tile and card is `12px`; the bento container is `28px`.** Add no other radii.
