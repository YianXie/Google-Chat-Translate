import type {
  Availability,
  CreateOptions,
  DetectionCandidate,
  LanguageDetectorApi,
  LanguageDetectorInstance,
  LanguagePair,
  TranslatorApi,
  TranslatorInstance,
} from '../../src/shared/built-in-ai';

function monitorListeners(options: CreateOptions | undefined): ((event: { loaded: number }) => void)[] {
  const listeners: ((event: { loaded: number }) => void)[] = [];
  options?.monitor?.({ addEventListener: (_type, listener) => listeners.push(listener) });
  return listeners;
}

function reportProgress(options: CreateOptions | undefined, steps: number[]): void {
  const listeners = monitorListeners(options);
  for (const loaded of steps) for (const listener of listeners) listener({ loaded });
}

/** Translates to "[es>en] text". Pairs default to 'unavailable' until given an availability. */
export class FakeTranslatorApi implements TranslatorApi {
  readonly packs = new Map<string, Availability>();
  readonly created: string[] = [];
  readonly translated: string[] = [];
  /** While set, downloads wait for it, so tests can hold a download open. */
  downloadGate: Promise<void> | null = null;
  failNextCreate = false;
  failTranslations = false;
  /** How many more create() calls fail the way they do while Chrome's shared library is still downloading. */
  createsBeforeLibrary = 0;
  /** Changes the text before it is "translated", to imitate what real models do to it. */
  rewrite: (input: string) => string = (input) => input;
  /** Reports progress on the download in flight, for tests that hold one open. */
  reportDownloadProgress: (loaded: number) => void = () => {};
  private packsInstalled = 0;

  set(source: string, target: string, availability: Availability): this {
    this.packs.set(`${source}>${target}`, availability);
    return this;
  }

  async availability({ sourceLanguage, targetLanguage }: LanguagePair): Promise<Availability> {
    return this.packs.get(`${sourceLanguage}>${targetLanguage}`) ?? 'unavailable';
  }

  async create(options: LanguagePair & CreateOptions): Promise<TranslatorInstance> {
    const pair = `${options.sourceLanguage}>${options.targetLanguage}`;
    this.created.push(pair);
    const state = this.packs.get(pair) ?? 'unavailable';
    if (state === 'unavailable') throw new DOMException('Unsupported language pair', 'NotSupportedError');
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new DOMException('Download failed', 'NetworkError');
    }
    if (this.createsBeforeLibrary > 0) {
      this.createsBeforeLibrary -= 1;
      throw new DOMException('Unable to create translator for the given source and target language.', 'NotSupportedError');
    }
    if (state !== 'available') {
      const listeners = monitorListeners(options);
      const report = (loaded: number) => {
        for (const listener of listeners) listener({ loaded });
      };
      this.reportDownloadProgress = report;
      report(0);
      await this.downloadGate;
      report(0.5);
      report(1);
      this.packs.set(pair, 'available');
      this.packsInstalled += 1;
    }
    const packsAtCreation = this.packsInstalled;
    return {
      translate: async (input) => {
        // As Chrome does: installing a language pack breaks every existing translator.
        if (this.failTranslations || packsAtCreation !== this.packsInstalled) {
          throw new DOMException('Other generic failures occurred.', 'UnknownError');
        }
        this.translated.push(input);
        return `[${pair}] ${this.rewrite(input)}`;
      },
      destroy: () => {},
    };
  }
}

/** Answers from `results`, keyed by the exact input text; anything else is 'und'. */
export class FakeLanguageDetectorApi implements LanguageDetectorApi {
  state: Availability = 'available';
  readonly results = new Map<string, DetectionCandidate[]>();
  creates = 0;
  downloadGate: Promise<void> | null = null;

  async availability(): Promise<Availability> {
    return this.state;
  }

  async create(options?: CreateOptions): Promise<LanguageDetectorInstance> {
    this.creates += 1;
    if (this.state === 'unavailable') throw new DOMException('Unavailable', 'NotSupportedError');
    if (this.state !== 'available') {
      reportProgress(options, [0]);
      await this.downloadGate;
      reportProgress(options, [1]);
      this.state = 'available';
    }
    return {
      detect: async (input) => this.results.get(input) ?? [{ detectedLanguage: 'und', confidence: 1 }],
      destroy: () => {},
    };
  }
}

/** A promise plus the function that settles it. */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
