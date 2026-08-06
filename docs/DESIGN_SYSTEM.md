# Sky Runners App — Design System

Derived from the Stanford Student Robotics HQ reference UI Anish supplied.

**Rule zero: never hardcode a color, radius, or font.** Everything lives as a token in
`app/globals.css` under `@theme`. Change it there and it updates everywhere.

---

## The visual idea

Warm, calm, document-like. Content sits in white cards floating on an off-white page,
separated by hairline borders rather than shadows. One accent color — Stanford cardinal —
used sparingly enough that it still means something when it appears.

This suits an app that will be **dense with information**. A member should be able to
scan a page and find the one thing they need, which requires restraint everywhere else.

---

## Tokens

### Color

| Token | Value | Use |
|---|---|---|
| `--color-cardinal-600` | `#8c1515` | Primary. Buttons, section labels, active nav, links |
| `--color-cardinal-700` | `#6b0f0f` | Hover |
| `--color-cardinal-50` | `#fdf5f5` | Tinted backgrounds, avatar chips |
| `--color-surface` | `#f7f5f3` | Page background. **Warm off-white, never pure white** |
| `--color-card` | `#ffffff` | Card background |
| `--color-line` | `#e8e4e0` | Hairline borders |
| `--color-line-soft` | `#f0edea` | Dividers inside a card |
| `--color-ink` | `#1a1a1a` | Headings and values |
| `--color-ink-soft` | `#5f5f5f` | Body text, descriptions |
| `--color-ink-muted` | `#8a8a8a` | Labels, captions, metadata |

Status pairs (background + foreground): `ok` green, `warn` amber, `risk` cardinal,
`neutral` gray. Used only in `Badge`.

### Radius

| Token | Value | Use |
|---|---|---|
| `--radius-card` | 16px | Cards |
| `--radius-tile` | 12px | Stat tiles, buttons, list rows |
| full | — | Pills, badges, avatars |

### Type

**Inter**, loaded via `next/font`. Headings get `-0.02em` tracking — the reference has
noticeably tight headline spacing.

| Role | Spec |
|---|---|
| Page title | `text-4xl font-bold` |
| Card heading | `text-2xl font-bold` |
| Sub-heading | `text-[17px] font-bold` |
| Body | `text-[15px] text-ink-soft` |
| Value | `text-xl font-bold text-ink` |
| **Section label** | `text-[11px] font-semibold uppercase tracking-[0.1em] text-cardinal-600` |
| Field label | `text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted` |

---

## The section label does the heavy lifting

Those small uppercase cardinal labels — `LEAD PORTAL`, `TEAM SUMMARY`, `OPERATIONS`,
`REPORT DUE` — are the most distinctive element of the reference design, and they're
functional rather than decorative. They tell the reader *what kind of thing* they're
looking at before they read the heading.

For an app whose top requirement is that new members orient fast, that's worth a lot.
**Every section gets one.** Use `<SectionLabel>`.

---

## Components

| Component | Purpose |
|---|---|
| `Card` / `CardBody` / `CardDivider` | The base surface. Almost all content lives in one |
| `PageHeader` | Banner: label, title, description, optional primary action |
| `SectionLabel` / `FieldLabel` | Uppercase orientation labels |
| `StatTile` | Bordered tile, small label above a bold value |
| `DetailRow` | Stacked label/value pair, divider-separated |
| `Badge` | Status pill. Tones: ok / warn / risk / neutral / cardinal |
| `Button` / `ButtonLink` | primary (solid cardinal), secondary (bordered), ghost |
| `Donut` | Ring progress figure. Hand-rolled SVG, no chart library |
| `ComingSoon` | Placeholder naming the phase a page arrives in |

---

## Layout

- Page max width `1400px`, padding `px-5` mobile / `px-8` desktop
- Card padding `p-6` mobile / `p-7` desktop
- Vertical rhythm between cards: `space-y-6`
- Sticky top nav, `68px` tall, white, hairline bottom border
- Two-column pages use `lg:grid-cols-[300px_1fr]` — narrow summary left, content right

---

## Rules

1. **No shadows.** Separation comes from hairline borders. The reference has none.
2. **No pure white page background.** The warm `--color-surface` is what makes cards read
   as cards.
3. **Cardinal is for emphasis, not decoration.** If everything is red, nothing is.
4. **Status via `Badge` only** — never colored body text, which harms scanability.
5. **Empty states always offer a next action.** A new member should never hit a dead end
   that doesn't say what to do. This is the "productive in five minutes" principle
   expressed at the component level.
6. **Mobile-first for high-frequency actions.** Hours get logged in the lab, on a phone.
7. **Visible focus rings.** Set globally in `globals.css`. Don't remove them —
   keyboard users need them, and it's an accessibility requirement, not a style choice.
