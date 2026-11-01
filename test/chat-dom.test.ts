import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractMessageText,
  findMessage,
  getBodies,
  getBody,
  getBubble,
  getMessageId,
  isTranslatable,
} from '../src/content/chat-dom';

const fixture = readFileSync('test/fixtures/chat.html', 'utf8');

function message(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[role="main"] [data-id="${id}"]`);
  if (!element) throw new Error(`no message ${id} in the fixture`);
  return element;
}

beforeEach(() => {
  document.body.innerHTML = fixture;
});

describe('findMessage', () => {
  it('finds the message around any node inside it', () => {
    const text = message('msg-es').querySelector('[jsname="bgckF"]')?.firstChild ?? null;
    expect(findMessage(text)).toBe(message('msg-es'));
  });

  it('recognises messages by their fallback attributes', () => {
    const body = message('msg-fallback').querySelector('.DTp27d');
    expect(findMessage(body)).toBe(message('msg-fallback'));
  });

  it('ignores the message composer', () => {
    expect(findMessage(document.querySelector('.composer [jsname="bgckF"]'))).toBeNull();
  });

  it('returns null outside messages', () => {
    expect(findMessage(document.body)).toBeNull();
    expect(findMessage(null)).toBeNull();
  });
});

describe('getMessageId and getBody', () => {
  it('reads the message id', () => {
    expect(getMessageId(message('msg-rich'))).toBe('msg-rich');
  });

  it("returns the message's own body, not a quoted message's", () => {
    expect(getBody(message('msg-rich'))?.id).toBe('msg-rich/qJTHM');
  });

  it('ignores a body nested inside a quote', () => {
    const own = getBody(message('msg-rich'));
    const quoted = document.createElement('div');
    quoted.setAttribute('jsname', 'bgckF');
    message('msg-rich').querySelector('[aria-hidden="true"]')?.append(quoted);
    message('msg-rich').querySelector('.EAOoq')?.prepend(own?.querySelector('[aria-hidden="true"]') as Element);

    expect(getBody(message('msg-rich'))).toBe(own);
  });

  it('falls back to the body class', () => {
    expect(getBody(message('msg-fallback'))?.id).toBe('msg-fallback/qJTHM');
  });

  it('finds the bubble around the body', () => {
    expect(getBubble(message('msg-es'))?.getAttribute('jsname')).toBe('o7uNDd');
  });
});

describe('getBodies', () => {
  it('returns every copy of a message, including the thread panel', () => {
    expect(getBodies(document, 'msg-es')).toHaveLength(2);
  });

  it('returns nothing for messages that are not on screen', () => {
    expect(getBodies(document, 'missing')).toEqual([]);
  });
});

describe('extractMessageText', () => {
  it('reads plain text and skips hidden helper text', () => {
    expect(extractMessageText(getBody(message('msg-es'))!)).toBe('¿Nos vemos mañana a las 3?');
  });

  it('keeps mentions, links, emoji and line breaks, and drops quotes, code and controls', () => {
    expect(extractMessageText(getBody(message('msg-rich'))!)).toBe(
      'Hola @Ben Li, mira este enlace 😀\nSegunda línea\nTercera línea',
    );
  });

  it("keeps a sentence together around a link's empty tooltip elements", () => {
    expect(extractMessageText(getBody(message('msg-link'))!)).toBe('Mira el informe antes de la reunión.');
  });

  it('keeps inline code in its sentence, and leaves out code blocks', () => {
    expect(extractMessageText(getBody(message('msg-code'))!)).toBe('Pon DEBUG en true y reinicia');
  });
});

describe('isTranslatable', () => {
  it('needs at least one letter', () => {
    expect(isTranslatable('hola')).toBe(true);
    expect(isTranslatable('谢谢')).toBe(true);
    expect(isTranslatable('👍 123 !!')).toBe(false);
    expect(isTranslatable('')).toBe(false);
  });
});
