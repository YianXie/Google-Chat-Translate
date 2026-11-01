import { PICKER_CSS } from '../shared/language-picker';

// Shadow-root styles. The translation block inherits Chat's font and text colour,
// so it matches light and dark themes without knowing which one is active. The
// floating button and the menu sit outside Chat's DOM, so they carry their own
// palettes, switched by data-theme.

const FONT = '"Google Sans", Roboto, "Segoe UI", Arial, sans-serif';

export const OVERLAY_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
.translate {
  position: fixed;
  z-index: 2147483646;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  box-sizing: border-box;
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: 50%;
  background: #fff;
  color: #1f1f1f;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
  font: 600 11px/1 ${FONT};
  cursor: pointer;
}
.translate:hover { background: #e8f0fe; }
.translate:focus-visible { outline: 2px solid #0b57d0; outline-offset: 2px; }
:host([data-theme="dark"]) .translate {
  border-color: rgb(255 255 255 / 0.16);
  background: #2d2e30;
  color: #e3e3e3;
}
:host([data-theme="dark"]) .translate:hover { background: #3c4043; }
`;

export const MENU_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
.menu {
  --gct-surface: #fff;
  --gct-text: #1f1f1f;
  --gct-border: #c4c7c5;
  --gct-field: #fff;
  --gct-accent: #0b57d0;
  --gct-on-accent: #fff;
  position: fixed;
  z-index: 2147483646;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  width: 280px;
  box-sizing: border-box;
  padding: 14px;
  border-radius: 12px;
  background: var(--gct-surface);
  color: var(--gct-text);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.24);
  font: 14px/1.4 ${FONT};
}
:host([data-theme="dark"]) .menu {
  --gct-surface: #2d2e30;
  --gct-text: #e3e3e3;
  --gct-border: #5f6368;
  --gct-field: #202124;
  --gct-accent: #a8c7fa;
  --gct-on-accent: #062e6f;
}
.title { font-weight: 600; }
.translate {
  justify-self: end;
  padding: 6px 16px;
  border: 0;
  border-radius: 16px;
  background: var(--gct-accent);
  color: var(--gct-on-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.note { margin: 0; font-size: 12px; opacity: 0.7; }
${PICKER_CSS}
`;

export const BLOCK_CSS = `
:host {
  display: block;
  width: 100%;
  flex: 0 0 auto;
  align-self: stretch;
  overflow: visible;
  box-sizing: border-box;
  margin: 0;
  font: inherit;
  color: inherit;
}
[hidden] { display: none !important; }
.block {
  margin-top: 2px;
  border-inline-start: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  padding: 1px 0 1px 10px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  white-space: normal;
  opacity: 0.75;
}
.toggle, .hide {
  font: inherit;
  color: inherit;
  border: 0;
  cursor: pointer;
}
.toggle {
  font-weight: 600;
  line-height: 1.5;
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.toggle:hover { background: color-mix(in srgb, currentColor 18%, transparent); }
.label { overflow: hidden; text-overflow: ellipsis; }
:host([data-state="error"]) .label { font-weight: 600; }
.hide {
  padding: 0;
  background: none;
  text-decoration: underline;
}
.hide::before {
  content: "·";
  display: inline-block;
  margin-inline-end: 6px;
  text-decoration: none;
}
.progress {
  max-width: 240px;
  height: 3px;
  margin-top: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in srgb, currentColor 15%, transparent);
}
.bar {
  width: 0;
  height: 100%;
  background: currentColor;
  opacity: 0.6;
  transition: width 0.2s;
}
.text {
  margin-top: 2px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
`;
